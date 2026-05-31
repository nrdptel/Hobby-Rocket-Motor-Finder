"""Tests for the polite HTTP client.

We replace the underlying httpx.AsyncClient with one wired to
``httpx.MockTransport`` so no network calls leave the test process. The
politeness invariants we assert are the contract the live scrapers depend
on:

  * never more than ``max_concurrent_per_host`` requests in flight per host;
  * at least ``min_start_interval_s`` between consecutive request *starts*
    against the same host;
  * ``Retry-After`` on 429/503 produces an additional sleep before the
    response is returned to the caller.
"""
from __future__ import annotations

import asyncio

import httpx
import pytest

from hpr_finder.http import USER_AGENT, PoliteAsyncClient


def _make_client_with_mock_transport(
    handler,
    *,
    max_concurrent_per_host: int = 4,
    min_start_interval_s: float = 0.0,
) -> PoliteAsyncClient:
    """Build a PoliteAsyncClient whose underlying transport is mocked.

    The handler is invoked for every request; tests use it to record
    timestamps, return canned responses, or vary by URL.
    """
    pc = PoliteAsyncClient(
        max_concurrent_per_host=max_concurrent_per_host,
        min_start_interval_s=min_start_interval_s,
    )
    pc._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        headers={"User-Agent": USER_AGENT},
    )
    return pc


# --- USER_AGENT identity ----------------------------------------------------

def test_user_agent_identifies_the_project():
    """Vendors get a contact channel — the UA must point to a way to
    reach the operator. This is non-negotiable per the project's scraping
    ethics."""
    assert "HPRMotorFinder" in USER_AGENT
    assert "github.com" in USER_AGENT
    # No personal email leaks into the UA — see project disclaimer.
    assert "@gmail.com" not in USER_AGENT
    assert "@yahoo.com" not in USER_AGENT


# --- min-interval pacing ----------------------------------------------------

@pytest.mark.asyncio
async def test_min_start_interval_enforced_sequentially():
    """Two consecutive gets to the same host must have at least
    ``min_start_interval_s`` between their start times."""
    INTERVAL = 0.10
    starts: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        starts.append(asyncio.get_event_loop().time())
        return httpx.Response(200, text="ok")

    pc = _make_client_with_mock_transport(handler, min_start_interval_s=INTERVAL)
    try:
        await pc.get("https://example.com/a")
        await pc.get("https://example.com/b")
    finally:
        await pc.close()

    assert len(starts) == 2
    gap = starts[1] - starts[0]
    # Real-clock fuzz: ±10ms tolerance is generous for asyncio scheduling.
    assert gap >= INTERVAL - 0.01, f"interval too tight: {gap:.3f}s < {INTERVAL}s"


@pytest.mark.asyncio
async def test_min_start_interval_does_not_throttle_different_hosts():
    """The interval is per-host. A request to host B should not be delayed
    because we recently hit host A."""
    INTERVAL = 0.20
    by_host: dict[str, list[float]] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        by_host.setdefault(request.url.host, []).append(
            asyncio.get_event_loop().time()
        )
        return httpx.Response(200, text="ok")

    pc = _make_client_with_mock_transport(handler, min_start_interval_s=INTERVAL)
    try:
        loop = asyncio.get_event_loop()
        t0 = loop.time()
        await asyncio.gather(
            pc.get("https://a.example/x"),
            pc.get("https://b.example/x"),
        )
        elapsed = loop.time() - t0
    finally:
        await pc.close()

    # Both requests should have fired roughly together, NOT separated by
    # the 200ms interval.
    assert elapsed < INTERVAL, (
        f"cross-host gating happened — elapsed {elapsed:.3f}s suggests host B "
        f"waited for host A's interval"
    )


# --- concurrency cap --------------------------------------------------------

@pytest.mark.asyncio
async def test_concurrency_cap_enforced_per_host():
    """With ``max_concurrent_per_host=2`` and a handler that takes 0.1s,
    issuing 4 concurrent requests should serialize into ~2 batches
    (~0.2s wall clock), not 4 concurrent (~0.1s)."""
    SLEEP = 0.10
    in_flight = 0
    max_in_flight = 0
    lock = asyncio.Lock()

    async def async_handler(request: httpx.Request) -> httpx.Response:
        nonlocal in_flight, max_in_flight
        async with lock:
            in_flight += 1
            max_in_flight = max(max_in_flight, in_flight)
        try:
            await asyncio.sleep(SLEEP)
            return httpx.Response(200, text="ok")
        finally:
            async with lock:
                in_flight -= 1

    pc = _make_client_with_mock_transport(
        async_handler, max_concurrent_per_host=2, min_start_interval_s=0.0
    )
    try:
        await asyncio.gather(*[pc.get(f"https://example.com/{i}") for i in range(4)])
    finally:
        await pc.close()

    assert max_in_flight <= 2, (
        f"observed {max_in_flight} concurrent requests — semaphore cap of 2 violated"
    )


# --- Retry-After honoring ---------------------------------------------------

@pytest.mark.asyncio
async def test_retry_after_sleeps_before_returning_429():
    """A 429 with ``Retry-After: 0.15`` (seconds) must produce at least
    ~150ms of waiting before the response is returned. The client doesn't
    retry — it just sleeps, so the caller's next attempt is naturally
    spaced. (We choose 429 because 503 is identical here.)"""
    RETRY_AFTER = 0.15

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429, text="too many", headers={"Retry-After": str(RETRY_AFTER)}
        )

    pc = _make_client_with_mock_transport(handler, min_start_interval_s=0.0)
    try:
        loop = asyncio.get_event_loop()
        t0 = loop.time()
        resp = await pc.get("https://example.com/throttled")
        elapsed = loop.time() - t0
    finally:
        await pc.close()

    assert resp.status_code == 429
    assert elapsed >= RETRY_AFTER - 0.01, (
        f"elapsed {elapsed:.3f}s < Retry-After {RETRY_AFTER}s — header was ignored"
    )


@pytest.mark.asyncio
async def test_bogus_retry_after_does_not_crash():
    """A non-numeric ``Retry-After`` value must be tolerated (vendors
    sometimes send HTTP-dates or other formats). The request returns
    normally, no exception."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429, text="too many", headers={"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"}
        )

    pc = _make_client_with_mock_transport(handler)
    try:
        # Should not raise. We don't honor HTTP-date format, but we
        # MUST NOT crash on it.
        resp = await pc.get("https://example.com/throttled")
        assert resp.status_code == 429
    finally:
        await pc.close()


# --- Body delivery sanity ---------------------------------------------------

@pytest.mark.asyncio
async def test_get_returns_response_body():
    """End-to-end happy path: the client returns the response object
    intact and we can read .text from it."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="hello from mock")

    pc = _make_client_with_mock_transport(handler)
    try:
        r = await pc.get("https://example.com/")
    finally:
        await pc.close()

    assert r.status_code == 200
    assert r.text == "hello from mock"
