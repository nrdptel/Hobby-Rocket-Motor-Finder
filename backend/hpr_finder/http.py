from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Iterator

import httpx

USER_AGENT = (
    "HPRMotorFinder/0.1 (+https://github.com/nrdptel/hpr-finder; contact: nrdptel@gmail.com) "
    "aggregator-spike"
)

DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class PoliteClient:
    """httpx client wrapper that rate-limits per host and identifies itself.

    Default policy: 30 seconds between requests to the same host. Honors
    Retry-After on 429/503 by sleeping the full duration before returning.
    """

    def __init__(self, min_interval_s: float = 30.0, timeout: httpx.Timeout = DEFAULT_TIMEOUT) -> None:
        self._client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
            timeout=timeout,
            follow_redirects=True,
        )
        self._min_interval_s = min_interval_s
        self._last_request_by_host: dict[str, float] = {}

    def get(self, url: str, **kwargs) -> httpx.Response:
        host = httpx.URL(url).host
        now = time.monotonic()
        last = self._last_request_by_host.get(host, 0.0)
        wait = self._min_interval_s - (now - last)
        if wait > 0:
            time.sleep(wait)
        try:
            resp = self._client.get(url, **kwargs)
        finally:
            self._last_request_by_host[host] = time.monotonic()
        if resp.status_code in (429, 503):
            ra = resp.headers.get("Retry-After")
            if ra:
                try:
                    time.sleep(float(ra))
                except ValueError:
                    pass
        return resp

    def close(self) -> None:
        self._client.close()


@contextmanager
def polite_client(min_interval_s: float = 30.0) -> Iterator[PoliteClient]:
    c = PoliteClient(min_interval_s=min_interval_s)
    try:
        yield c
    finally:
        c.close()
