"""Async HTTP client for scrapers with per-host concurrency + rate limiting."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx

USER_AGENT = (
    "HPRMotorFinder/0.1 (+https://github.com/nrdptel/hpr-finder; contact: nrdptel@gmail.com) "
    "aggregator-spike"
)

DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class PoliteAsyncClient:
    """httpx.AsyncClient wrapped with per-host politeness controls.

    Two limits are enforced together for each host:
      * ``max_concurrent_per_host`` — at most N requests are in flight at any time
      * ``min_start_interval_s`` — at least this much time between two request *starts*

    Combined, they cap aggregate throughput. Example: 4 concurrent + 0.5s interval
    gives ~8 reqs/s sustained, suitable for a small ecommerce host that has no
    published Crawl-delay but should still be treated kindly.

    Honors ``Retry-After`` on 429/503 by sleeping the full duration before
    returning the response to the caller.
    """

    def __init__(
        self,
        *,
        max_concurrent_per_host: int = 4,
        min_start_interval_s: float = 0.5,
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
        self._semaphores: dict[str, asyncio.Semaphore] = {}
        self._next_start_time: dict[str, float] = {}
        self._rate_lock = asyncio.Lock()

    def _semaphore_for(self, host: str) -> asyncio.Semaphore:
        sem = self._semaphores.get(host)
        if sem is None:
            sem = asyncio.Semaphore(self._max_concurrent)
            self._semaphores[host] = sem
        return sem

    async def get(self, url: str, **kwargs) -> httpx.Response:
        host = httpx.URL(url).host
        sem = self._semaphore_for(host)
        async with sem:
            loop = asyncio.get_event_loop()
            async with self._rate_lock:
                now = loop.time()
                scheduled = max(now, self._next_start_time.get(host, 0.0))
                self._next_start_time[host] = scheduled + self._min_interval_s
            wait = scheduled - loop.time()
            if wait > 0:
                await asyncio.sleep(wait)
            resp = await self._client.get(url, **kwargs)
            if resp.status_code in (429, 503):
                ra = resp.headers.get("Retry-After")
                if ra:
                    try:
                        await asyncio.sleep(float(ra))
                    except ValueError:
                        pass
            return resp

    async def close(self) -> None:
        await self._client.aclose()


@asynccontextmanager
async def polite_async_client(
    *,
    max_concurrent_per_host: int = 4,
    min_start_interval_s: float = 0.5,
) -> AsyncIterator[PoliteAsyncClient]:
    c = PoliteAsyncClient(
        max_concurrent_per_host=max_concurrent_per_host,
        min_start_interval_s=min_start_interval_s,
    )
    try:
        yield c
    finally:
        await c.close()
