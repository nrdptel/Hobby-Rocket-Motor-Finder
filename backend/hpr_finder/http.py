"""Async HTTP client for scrapers with per-host concurrency + rate limiting."""
from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

log = logging.getLogger(__name__)

USER_AGENT = (
    "HPRMotorFinder/0.1 "
    "(+https://github.com/nrdptel/Hobby-Rocket-Motor-Finder; "
    "contact: https://github.com/nrdptel/Hobby-Rocket-Motor-Finder/issues)"
)

DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# Statuses worth a retry after a backoff. 5xx are transient server hiccups; 429
# (rate-limited) and 403 (often a WAF/bot block) are retried too. When the server
# sends Retry-After we honor it in place of our own backoff.
RETRYABLE_STATUS = (403, 429, 502, 503, 504)

# The subset that means "this IP is being blocked/throttled" rather than "the
# server hiccuped." These — and only these — trigger a one-time fail-over to the
# proxy (when one is configured): the retry then leaves from a fresh residential
# IP, the most likely way past a per-IP block. A 5xx stays on the same connection
# because a different IP won't fix a server-side error.
PROXY_FAILOVER_STATUS = (403, 429)

# A vendor sending an absurd Retry-After (or a malicious/buggy one) shouldn't be
# able to stall the whole hourly run. Cap how long we'll honor it.
MAX_RETRY_AFTER_S = 30.0


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

    Proxy fail-over (``proxy_fallback``): every request goes out DIRECT first. Only
    when one comes back 429/403 — a per-IP block/throttle — does the retry switch to
    the proxy, so its fresh residential IP can get through. That means the proxy (a
    metered, paid endpoint) costs nothing while vendors are healthy and kicks in
    automatically the moment one starts blocking us — no per-vendor allow-list to
    maintain, and any vendor (even a new one) self-heals. When ``proxy_fallback`` is
    None — the default, and whenever the deploy secret is unset — there's no proxy
    client at all and every request stays direct, exactly as before.
    """

    def __init__(
        self,
        *,
        max_concurrent_per_host: int = 4,
        min_start_interval_s: float = 0.5,
        max_retries: int = 2,
        backoff_base_s: float = 0.5,
        timeout: httpx.Timeout = DEFAULT_TIMEOUT,
        proxy_fallback: str | None = None,
    ) -> None:
        common = dict(
            headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
            timeout=timeout,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=max_concurrent_per_host * 4),
        )
        # The direct connection is the default path for every request.
        self._client = httpx.AsyncClient(**common)
        # A second client bound to the proxy, built only when a fallback endpoint is
        # given. Lazy: httpx opens no connection until a request actually fails over.
        # A malformed proxy URL must NOT crash scraping — the proxy is best-effort,
        # so on a bad value we log and carry on direct-only (no fail-over).
        self._proxy_client: httpx.AsyncClient | None = None
        if proxy_fallback:
            try:
                self._proxy_client = httpx.AsyncClient(proxy=proxy_fallback, **common)
            except Exception:  # noqa: BLE001 — any bad proxy config; degrade, don't crash
                log.warning(
                    "SCRAPER_PROXY_URL is not a usable proxy URL — scraping direct "
                    "with no fail-over"
                )
        self._max_concurrent = max_concurrent_per_host
        self._min_interval_s = min_start_interval_s
        self._max_retries = max_retries
        self._backoff_base_s = backoff_base_s
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

    def _backoff_delay(self, attempt: int) -> float:
        """Exponential backoff with jitter: a random wait in ``[d, 2d)`` where
        ``d = backoff_base_s * 2**attempt``. The floor guarantees a real pause on a
        struggling host; the jitter desynchronizes concurrent retries."""
        d = self._backoff_base_s * 2**attempt
        return d + random.uniform(0.0, d)

    async def get(self, url: str, **kwargs) -> httpx.Response:
        host = httpx.URL(url).host
        sem = self._semaphore_for(host)
        async with sem:
            last_exc: Exception | None = None
            client = self._client  # direct first
            via_proxy = False
            for attempt in range(self._max_retries + 1):
                # Re-pace on every attempt — a retry is another request start.
                await self._await_start_slot(host)
                try:
                    resp = await client.get(url, **kwargs)
                except httpx.TransportError as exc:
                    # Connection reset / timeout / protocol error: retry if we can.
                    last_exc = exc
                    if attempt < self._max_retries:
                        await asyncio.sleep(self._backoff_delay(attempt))
                        continue
                    raise
                if resp.status_code in RETRYABLE_STATUS and attempt < self._max_retries:
                    # A 429/403 (per-IP block) fails over to the proxy for the retry
                    # so it leaves from a fresh IP; a 5xx just retries on the same
                    # connection. Fail over at most once — once on the proxy, stay.
                    if (
                        resp.status_code in PROXY_FAILOVER_STATUS
                        and self._proxy_client is not None
                        and not via_proxy
                    ):
                        client = self._proxy_client
                        via_proxy = True
                        log.info(
                            "%s returned %d — retrying via proxy", host, resp.status_code
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
    proxy_fallback: str | None = None,
) -> AsyncIterator[PoliteAsyncClient]:
    c = PoliteAsyncClient(
        max_concurrent_per_host=max_concurrent_per_host,
        min_start_interval_s=min_start_interval_s,
        max_retries=max_retries,
        proxy_fallback=proxy_fallback,
    )
    try:
        yield c
    finally:
        await c.close()
