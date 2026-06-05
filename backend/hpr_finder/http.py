"""Async HTTP client for scrapers with per-host concurrency + rate limiting."""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

USER_AGENT = (
    "HPRMotorFinder/0.1 "
    "(+https://github.com/nrdptel/Hobby-Rocket-Motor-Finder; "
    "contact: https://github.com/nrdptel/Hobby-Rocket-Motor-Finder/issues)"
)

DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# Transient server-side failures worth a retry. 429 is handled separately: it
# means "you're going too fast," so we honor Retry-After and back off rather
# than hammering again.
RETRYABLE_STATUS = (502, 503, 504)

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

    Resilience: transient transport errors (connection resets, timeouts) and
    transient server errors (502/503/504) are retried up to ``max_retries`` times
    with exponential backoff. This is what keeps an intermittently-flaky vendor
    (e.g. AMW/Sirius blocking CI data-center IPs on the first hit) from failing a
    whole scrape on a single hiccup. A 429 is NOT retried — it means we're being
    rate-limited, so we honor ``Retry-After`` by sleeping and return the response
    so the caller spaces out naturally rather than retrying into the same wall.
    """

    def __init__(
        self,
        *,
        max_concurrent_per_host: int = 4,
        min_start_interval_s: float = 0.5,
        max_retries: int = 2,
        backoff_base_s: float = 0.5,
        timeout: httpx.Timeout = DEFAULT_TIMEOUT,
    ) -> None:
        self._client = httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
            timeout=timeout,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=max_concurrent_per_host * 4),
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
        loop = asyncio.get_event_loop()
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

    async def get(self, url: str, **kwargs) -> httpx.Response:
        host = httpx.URL(url).host
        sem = self._semaphore_for(host)
        async with sem:
            last_exc: Exception | None = None
            for attempt in range(self._max_retries + 1):
                # Re-pace on every attempt — a retry is another request start.
                await self._await_start_slot(host)
                try:
                    resp = await self._client.get(url, **kwargs)
                except httpx.TransportError as exc:
                    # Connection reset / timeout / protocol error: retry if we can.
                    last_exc = exc
                    if attempt < self._max_retries:
                        await asyncio.sleep(self._backoff_base_s * 2**attempt)
                        continue
                    raise
                if resp.status_code == 429:
                    # Rate-limited: honor Retry-After, then return (don't retry).
                    ra = self._retry_after_seconds(resp)
                    if ra is not None:
                        await asyncio.sleep(ra)
                    return resp
                if resp.status_code in RETRYABLE_STATUS and attempt < self._max_retries:
                    ra = self._retry_after_seconds(resp)
                    await asyncio.sleep(ra if ra is not None else self._backoff_base_s * 2**attempt)
                    continue
                return resp
            # Unreachable for status paths (they return); only transport errors
            # exhaust the loop, and the final attempt re-raises above.
            assert last_exc is not None
            raise last_exc

    async def close(self) -> None:
        await self._client.aclose()


@asynccontextmanager
async def polite_async_client(
    *,
    max_concurrent_per_host: int = 4,
    min_start_interval_s: float = 0.5,
    max_retries: int = 2,
) -> AsyncIterator[PoliteAsyncClient]:
    c = PoliteAsyncClient(
        max_concurrent_per_host=max_concurrent_per_host,
        min_start_interval_s=min_start_interval_s,
        max_retries=max_retries,
    )
    try:
        yield c
    finally:
        await c.close()
