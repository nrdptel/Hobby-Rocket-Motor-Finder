"""Async HTTP client for scrapers with per-host concurrency + rate limiting."""
from __future__ import annotations

import asyncio
import logging
import random
import re
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

import httpx

log = logging.getLogger(__name__)

USER_AGENT = (
    "HPRMotorFinder/0.1 "
    "(+https://github.com/nrdptel/Hobby-Rocket-Motor-Finder; "
    "contact: https://github.com/nrdptel/Hobby-Rocket-Motor-Finder/issues)"
)

DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# Headers the Cloudflare Worker relay reads (see workers/scrape-relay/worker.js):
# the shared secret it authenticates, and the User-Agent to forward to the origin
# so the vendor still sees our honest, self-identifying UA.
RELAY_AUTH_HEADER = "X-Relay-Auth"
RELAY_UA_HEADER = "X-Relay-UA"

# Statuses worth a retry after a backoff. 5xx are transient server hiccups; 429
# (rate-limited) and 403 (often a WAF/bot block) are retried too. When the server
# sends Retry-After we honor it in place of our own backoff.
RETRYABLE_STATUS = (403, 429, 502, 503, 504)

# The subset that means "this IP is being blocked/throttled" rather than "the
# server hiccuped." These — and only these — escalate to the next fail-over
# channel (a cleaner egress IP), the most likely way past a per-IP block. A 5xx
# stays on the current channel because a different egress won't fix a server error.
FAILOVER_STATUS = (403, 429)

# Not every block announces itself with a status code. Some hosts answer a
# blocked/throttled IP with **HTTP 200** and a body that isn't the page we asked
# for — a WAF interstitial, a stripped error shell, an empty catalogue. Nothing
# above fires, so the scraper parses it as "this vendor has no products" and
# stores zero listings while reporting success: a total outage that looks like a
# quiet day. Callers that know what a good response must contain pass
# ``content_ok`` to ``get``; a 2xx whose body fails that check is retried and
# escalated like a 403, with one deliberate difference — it never reaches the
# METERED proxy. A status code is the origin declaring the block; a content check
# is us inferring it, and an inference doesn't get to spend money.

# A vendor sending an absurd Retry-After (or a malicious/buggy one) shouldn't be
# able to stall the whole hourly run. Cap how long we'll honor it.
MAX_RETRY_AFTER_S = 30.0

# Ceiling on how many requests may fail over to the METERED proxy per client — i.e.
# per vendor, per run. (The free Worker relay is NOT counted against this.) The
# vendors that legitimately reach the proxy fetch a handful of pages; this cap just
# bounds the blow-out case — a PER-PRODUCT vendor (moto_joe/csrocketry fetch ~550
# pages each) that gets WAF-blocked past the relay would otherwise route every one
# through the paid proxy. Past the cap it carries-forward. Bounded cost beats a bill.
DEFAULT_MAX_PROXY_FAILOVERS = 40


def _excerpt(resp: httpx.Response, limit: int = 200) -> str:
    """A short, single-line, printable sample of a response body for the logs.

    Best-effort by construction: a wall we've never seen could be anything, and
    trying to look at it must never be what breaks the run."""
    try:
        return re.sub(r"\s+", " ", resp.text[:limit]).strip() or "<empty body>"
    except Exception:  # noqa: BLE001 — undecodable/binary body; the excerpt is a nicety
        return "<undecodable body>"


class PoliteAsyncClient:
    """httpx.AsyncClient wrapped with per-host politeness controls.

    Two limits are enforced together for each host:
      * ``max_concurrent_per_host`` — at most N requests are in flight at any time
      * ``min_start_interval_s`` — at least this much time between two request *starts*

    Combined, they cap aggregate throughput. Example: 4 concurrent + 0.5s interval
    gives ~8 reqs/s sustained, suitable for a small ecommerce host that has no
    published Crawl-delay but should still be treated kindly.

    Resilience: transient transport errors (connection resets, timeouts) and the
    retryable statuses above (5xx, plus 429/403) are retried up to ``max_retries``
    times with exponentially-growing, jittered backoff — the jitter keeps parallel
    retries from re-synchronizing into a thundering herd. ``Retry-After`` is honored
    when present. If the retries are exhausted the final response is still RETURNED
    (not raised), so a persistently-blocked vendor degrades to carry-forward rather
    than crashing.

    Fail-over: every request goes out DIRECT first. Only when one comes back 429/403
    — or 2xx with a body the caller's ``content_ok`` rejects, the same block wearing a
    success status — does the retry escalate to a cleaner egress, in order:

      1. ``relay_url`` — a Cloudflare Worker fetch-relay. FREE (Cloudflare's egress,
         100k req/day) and a much cleaner IP reputation than a data-center or a
         flagged residential-proxy pool. This is the primary bypass. The origin
         still sees our honest UA (forwarded via ``X-Relay-UA``).
      2. ``proxy_fallback`` — a metered residential proxy (DataImpulse). The last
         resort, tried only if the relay is also blocked, and bounded by
         ``max_proxy_failovers`` so a blocked high-volume vendor can't run up the bill.

    Each tier is independent: configure both, either, or neither. With neither
    (the deploy secrets unset) every request stays direct, exactly as before.
    """

    def __init__(
        self,
        *,
        max_concurrent_per_host: int = 4,
        min_start_interval_s: float = 0.5,
        max_retries: int = 2,
        backoff_base_s: float = 0.5,
        timeout: httpx.Timeout = DEFAULT_TIMEOUT,
        relay_url: str | None = None,
        relay_secret: str | None = None,
        proxy_fallback: str | None = None,
        max_proxy_failovers: int = DEFAULT_MAX_PROXY_FAILOVERS,
    ) -> None:
        common = dict(
            headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
            timeout=timeout,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=max_concurrent_per_host * 4),
        )
        # The direct connection is the default path for every request; the relay
        # tier also rides on it (it just GETs the Worker URL).
        self._client = httpx.AsyncClient(**common)

        # Tier 1: Cloudflare Worker relay. A bad URL must NOT crash scraping — skip
        # the tier and log, same best-effort contract as the proxy.
        self._relay_url: str | None = None
        self._relay_secret = relay_secret or ""
        if relay_url:
            try:
                u = httpx.URL(relay_url)
                if u.scheme in ("http", "https") and u.host:
                    self._relay_url = str(u)
                else:
                    raise ValueError("relay URL needs an http(s) scheme and host")
            except Exception:  # noqa: BLE001 — any bad relay config; degrade, don't crash
                log.warning("SCRAPER_RELAY_URL is not a usable URL — skipping the relay tier")

        # Tier 2: metered residential proxy. Built lazily; a malformed value logs
        # and disables the tier rather than crashing.
        self._proxy_client: httpx.AsyncClient | None = None
        if proxy_fallback:
            try:
                self._proxy_client = httpx.AsyncClient(proxy=proxy_fallback, **common)
            except Exception:  # noqa: BLE001 — any bad proxy config; degrade, don't crash
                log.warning(
                    "SCRAPER_PROXY_URL is not a usable proxy URL — scraping direct "
                    "with no proxy fail-over"
                )

        self._max_concurrent = max_concurrent_per_host
        self._min_interval_s = min_start_interval_s
        self._max_retries = max_retries
        self._backoff_base_s = backoff_base_s
        self._max_proxy_failovers = max_proxy_failovers
        self._proxy_failover_count = 0  # requests that have used the METERED proxy this run
        self._semaphores: dict[str, asyncio.Semaphore] = {}
        self._next_start_time: dict[str, float] = {}
        self._rate_lock = asyncio.Lock()

    def _semaphore_for(self, host: str) -> asyncio.Semaphore:
        sem = self._semaphores.get(host)
        if sem is None:
            sem = asyncio.Semaphore(self._max_concurrent)
            self._semaphores[host] = sem
        return sem

    async def _await_start_slot(self, host: str) -> None:
        """Block until this host's next allowed request-start time, reserving the
        following slot so concurrent callers stay ``min_start_interval_s`` apart."""
        loop = asyncio.get_running_loop()
        async with self._rate_lock:
            now = loop.time()
            scheduled = max(now, self._next_start_time.get(host, 0.0))
            self._next_start_time[host] = scheduled + self._min_interval_s
        wait = scheduled - loop.time()
        if wait > 0:
            await asyncio.sleep(wait)

    @staticmethod
    def _retry_after_seconds(resp: httpx.Response) -> float | None:
        """Parse a numeric ``Retry-After`` (seconds) header, capped. HTTP-date
        form is unsupported — return None and fall back to our own backoff."""
        ra = resp.headers.get("Retry-After")
        if not ra:
            return None
        try:
            return min(float(ra), MAX_RETRY_AFTER_S)
        except ValueError:
            return None

    @staticmethod
    def _content_accepted(
        check: Callable[[httpx.Response], bool], resp: httpx.Response, url: str
    ) -> bool:
        """Run a caller's ``content_ok`` check without letting it break the fetch.

        A validator that raises (an unexpected encoding, a regex over a binary
        body) must not turn every good response into a retry storm, so an
        erroring check counts as *accepted* — the caller then parses whatever it
        got, exactly as it would have without the check."""
        try:
            return bool(check(resp))
        except Exception:  # noqa: BLE001 — a broken validator must not fail the fetch
            log.warning("content check raised for %s — accepting the response", url)
            return True

    def _backoff_delay(self, attempt: int) -> float:
        """Exponential backoff with jitter: a random wait in ``[d, 2d)`` where
        ``d = backoff_base_s * 2**attempt``. The floor guarantees a real pause on a
        struggling host; the jitter desynchronizes concurrent retries."""
        d = self._backoff_base_s * 2**attempt
        return d + random.uniform(0.0, d)

    async def _issue(self, channel: str, url: str, kwargs: dict) -> httpx.Response:
        """Issue the GET over one fail-over channel. ``relay`` rewrites the request
        to go through the Cloudflare Worker (which fetches the origin and returns its
        status + body); ``proxy`` routes the same request through the residential
        proxy client; ``direct`` is the normal connection."""
        if channel == "relay":
            # Fold any params into the target URL, hand the whole thing to the Worker
            # as one ?url= value, and forward our honest UA for the origin to see.
            target = str(httpx.URL(url).copy_merge_params(kwargs.get("params") or {}))
            headers = {
                **(kwargs.get("headers") or {}),
                RELAY_AUTH_HEADER: self._relay_secret,
                RELAY_UA_HEADER: USER_AGENT,
            }
            passthrough = {k: v for k, v in kwargs.items() if k not in ("params", "headers")}
            return await self._client.get(
                self._relay_url, params={"url": target}, headers=headers, **passthrough
            )
        if channel == "proxy":
            assert self._proxy_client is not None
            return await self._proxy_client.get(url, **kwargs)
        return await self._client.get(url, **kwargs)

    async def get(
        self,
        url: str,
        *,
        content_ok: Callable[[httpx.Response], bool] | None = None,
        **kwargs,
    ) -> httpx.Response:
        """GET ``url`` with this client's politeness, retry and fail-over rules.

        ``content_ok`` is an optional predicate over a *successful* response: pass
        one when a 2xx alone doesn't prove the fetch worked (see the soft-block
        note above). Returning False marks the response blocked — retried, and
        escalated as far as the free relay but never to the metered proxy. Retries
        exhausted, the rejected response is still returned: the caller decides,
        same as for a final 403."""
        host = httpx.URL(url).host
        sem = self._semaphore_for(host)
        async with sem:
            # Ordered fail-over channels beyond the direct connection: the free
            # Cloudflare relay first, then the metered proxy as last resort. Empty
            # when neither is configured (pure direct, as before).
            channels: list[str] = []
            if self._relay_url:
                channels.append("relay")
            if self._proxy_client is not None:
                channels.append("proxy")

            last_exc: Exception | None = None
            channel = "direct"
            next_ch = 0  # index into `channels` of the next escalation to try
            for attempt in range(self._max_retries + 1):
                # Re-pace on every attempt — a retry is another request start.
                await self._await_start_slot(host)
                try:
                    resp = await self._issue(channel, url, kwargs)
                except httpx.TransportError as exc:
                    # Connection reset / timeout / protocol error: retry if we can.
                    last_exc = exc
                    if attempt < self._max_retries:
                        await asyncio.sleep(self._backoff_delay(attempt))
                        continue
                    raise
                soft_blocked = (
                    content_ok is not None
                    and resp.is_success
                    and not self._content_accepted(content_ok, resp, url)
                )
                if soft_blocked:
                    # Log a body excerpt: nobody has seen what these walls look
                    # like (they only appear from CI egress), and the excerpt is
                    # what lets the next occurrence be diagnosed — and the content
                    # checks tuned — from the run log alone.
                    log.warning(
                        "%s returned %d but the body is not the page we asked for "
                        "(%d bytes) — treating it as a block. Body starts: %s",
                        host, resp.status_code, len(resp.content), _excerpt(resp),
                    )
                if (
                    resp.status_code in RETRYABLE_STATUS or soft_blocked
                ) and attempt < self._max_retries:
                    # A 429/403 (per-IP block) — or a soft block, which is the same
                    # thing wearing a 200 — escalates to the next cleaner egress; a
                    # 5xx just retries the current channel. The paid proxy tier is
                    # gated by the per-run budget — past it we don't reach for it.
                    blocked = soft_blocked or resp.status_code in FAILOVER_STATUS
                    why = "an unexpected body" if soft_blocked else str(resp.status_code)
                    if blocked and next_ch < len(channels):
                        candidate = channels[next_ch]
                        # A 403/429 is the origin telling us it blocked us; a
                        # failed content check is us inferring it. Only the former
                        # may reach the METERED proxy — a heuristic doesn't get to
                        # spend money, and a content check that goes wrong after a
                        # site redesign would spend it on every request. Soft
                        # blocks still get the free relay, which is what carries
                        # eRockets past its hard block today.
                        budget_ok = candidate != "proxy" or (
                            not soft_blocked
                            and self._proxy_failover_count < self._max_proxy_failovers
                        )
                        if budget_ok:
                            channel = candidate
                            next_ch += 1
                            if channel == "proxy":
                                self._proxy_failover_count += 1
                                log.info(
                                    "%s returned %s — retrying via proxy (%d/%d)",
                                    host, why, self._proxy_failover_count,
                                    self._max_proxy_failovers,
                                )
                            else:
                                log.info(
                                    "%s returned %s — retrying via %s",
                                    host, why, channel,
                                )
                    ra = self._retry_after_seconds(resp)
                    await asyncio.sleep(ra if ra is not None else self._backoff_delay(attempt))
                    continue
                # Success, a non-retryable status, or retries exhausted: hand the
                # response back so the caller decides. A final 429/403 returns (not
                # raises), so a blocked vendor carries forward instead of crashing.
                return resp
            # Unreachable for status paths (they return); only transport errors
            # exhaust the loop, and the final attempt re-raises above.
            assert last_exc is not None
            raise last_exc

    async def close(self) -> None:
        await self._client.aclose()
        if self._proxy_client is not None:
            await self._proxy_client.aclose()


@asynccontextmanager
async def polite_async_client(
    *,
    max_concurrent_per_host: int = 4,
    min_start_interval_s: float = 0.5,
    max_retries: int = 2,
    relay_url: str | None = None,
    relay_secret: str | None = None,
    proxy_fallback: str | None = None,
) -> AsyncIterator[PoliteAsyncClient]:
    c = PoliteAsyncClient(
        max_concurrent_per_host=max_concurrent_per_host,
        min_start_interval_s=min_start_interval_s,
        max_retries=max_retries,
        relay_url=relay_url,
        relay_secret=relay_secret,
        proxy_fallback=proxy_fallback,
    )
    try:
        yield c
    finally:
        await c.close()
