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
    max_retries: int = 2,
    backoff_base_s: float = 0.0,
    proxy_handler=None,
    max_proxy_failovers: int = 40,
) -> PoliteAsyncClient:
    """Build a PoliteAsyncClient whose underlying transport(s) are mocked.

    ``handler`` serves the DIRECT client. When ``proxy_handler`` is given, a
    second mocked client stands in for the proxy path, so fail-over tests can make
    the proxy behave differently from direct. ``backoff_base_s`` defaults to 0 so
    retry tests don't sleep on real wall-clock.
    """
    pc = PoliteAsyncClient(
        max_concurrent_per_host=max_concurrent_per_host,
        min_start_interval_s=min_start_interval_s,
        max_retries=max_retries,
        backoff_base_s=backoff_base_s,
        proxy_fallback="http://proxy.test:823" if proxy_handler is not None else None,
        max_proxy_failovers=max_proxy_failovers,
    )
    pc._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        headers={"User-Agent": USER_AGENT},
    )
    if proxy_handler is not None:
        pc._proxy_client = httpx.AsyncClient(
            transport=httpx.MockTransport(proxy_handler),
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
async def test_retry_after_honored_before_429_retry():
    """A 429 carrying ``Retry-After: 0.15`` waits at least ~150ms before the
    retry — we honor the host's requested pause instead of our own backoff. The
    retry then succeeds and that 200 is returned."""
    RETRY_AFTER = 0.15
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(429, text="too many", headers={"Retry-After": str(RETRY_AFTER)})
        return httpx.Response(200, text="ok")

    pc = _make_client_with_mock_transport(handler, min_start_interval_s=0.0)
    try:
        loop = asyncio.get_event_loop()
        t0 = loop.time()
        resp = await pc.get("https://example.com/throttled")
        elapsed = loop.time() - t0
    finally:
        await pc.close()

    assert resp.status_code == 200
    assert attempts == 2
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


# --- transient-error retry --------------------------------------------------

@pytest.mark.asyncio
async def test_retries_transport_error_then_succeeds():
    """A connection reset / timeout on the first attempt is retried and the
    eventual 200 is returned — a single hiccup must not fail the page."""
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise httpx.ConnectError("connection reset", request=request)
        return httpx.Response(200, text="ok")

    pc = _make_client_with_mock_transport(handler, max_retries=2)
    try:
        resp = await pc.get("https://example.com/flaky")
    finally:
        await pc.close()

    assert resp.status_code == 200
    assert attempts == 2  # failed once, retried once


@pytest.mark.asyncio
async def test_retries_503_then_succeeds():
    """A transient 502/503/504 is retried (unlike 429, which is rate-limiting)."""
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(503, text="unavailable")
        return httpx.Response(200, text="ok")

    pc = _make_client_with_mock_transport(handler, max_retries=2)
    try:
        resp = await pc.get("https://example.com/flaky")
    finally:
        await pc.close()

    assert resp.status_code == 200
    assert attempts == 2


@pytest.mark.asyncio
async def test_transport_error_raised_after_retries_exhausted():
    """If every attempt fails at the transport layer, the error propagates so
    the caller marks the vendor run failed — we don't swallow it."""
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        raise httpx.ConnectError("down", request=request)

    pc = _make_client_with_mock_transport(handler, max_retries=2)
    try:
        with pytest.raises(httpx.ConnectError):
            await pc.get("https://example.com/dead")
    finally:
        await pc.close()

    assert attempts == 3  # initial + 2 retries


@pytest.mark.asyncio
async def test_429_retried_then_returns_final():
    """A 429 is retried with backoff. If it persists through every attempt the final
    429 is RETURNED (not raised) so the vendor degrades to carry-forward rather than
    crashing. (This is the no-proxy path; fail-over is covered separately.)"""
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(429, text="slow down")

    pc = _make_client_with_mock_transport(handler, max_retries=2)
    try:
        resp = await pc.get("https://example.com/throttled")
    finally:
        await pc.close()

    assert resp.status_code == 429
    assert attempts == 3  # initial + 2 retries, then returned (not raised)


@pytest.mark.asyncio
async def test_403_retried_then_succeeds():
    """A 403 (WAF/bot block) is retryable: a transient one clears on the retry.
    (Direct path here — proxy fail-over is covered separately.)"""
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(403, text="forbidden")
        return httpx.Response(200, text="ok")

    pc = _make_client_with_mock_transport(handler, max_retries=2)
    try:
        resp = await pc.get("https://example.com/blocked")
    finally:
        await pc.close()

    assert resp.status_code == 200
    assert attempts == 2


@pytest.mark.asyncio
async def test_proxy_fallback_builds_a_second_proxied_client(monkeypatch):
    """proxy_fallback=<url> builds a SECOND httpx client bound to that proxy while
    the direct client stays proxy-less. With no fallback there's only the direct
    client and no proxy path at all."""
    captured: list[dict] = []
    real = httpx.AsyncClient

    def spy(*args, **kwargs):
        captured.append(kwargs)
        return real(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", spy)

    with_proxy = PoliteAsyncClient(proxy_fallback="http://user:pass@gw.example:823")
    try:
        # Direct client is built first (no proxy), then the proxied fallback client.
        assert captured[0].get("proxy") is None
        assert captured[1].get("proxy") == "http://user:pass@gw.example:823"
        assert with_proxy._proxy_client is not None
    finally:
        await with_proxy.close()

    captured.clear()
    direct_only = PoliteAsyncClient()
    try:
        assert len(captured) == 1  # only the direct client, no proxy path
        assert captured[0].get("proxy") is None
        assert direct_only._proxy_client is None
    finally:
        await direct_only.close()


@pytest.mark.asyncio
async def test_bad_proxy_url_disables_failover_without_crashing():
    """A malformed proxy URL (httpx rejects the scheme) must NOT raise at
    construction — it disables fail-over (no proxy client) and scraping continues
    direct. This is the guard for the outage where a scheme-less SCRAPER_PROXY_URL
    crashed every vendor with 'Unknown scheme for proxy URL'."""
    pc = PoliteAsyncClient(proxy_fallback="ftp://not-a-valid-proxy-scheme:1")
    try:
        assert pc._proxy_client is None  # fail-over silently disabled
        # And the direct client still works — swap in a mock and fetch.
        pc._client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda req: httpx.Response(200, text="ok")),
            headers={"User-Agent": USER_AGENT},
        )
        resp = await pc.get("https://example.com/")
        assert resp.status_code == 200
    finally:
        await pc.close()


# --- proxy fail-over --------------------------------------------------------

@pytest.mark.asyncio
async def test_429_fails_over_to_proxy_then_succeeds():
    """Direct-first: a 429 from the direct connection fails the retry over to the
    proxy, whose fresh IP succeeds. The direct client is hit once, the proxy once."""
    direct_hits = 0
    proxy_hits = 0

    def direct(request: httpx.Request) -> httpx.Response:
        nonlocal direct_hits
        direct_hits += 1
        return httpx.Response(429, text="blocked")

    def proxy(request: httpx.Request) -> httpx.Response:
        nonlocal proxy_hits
        proxy_hits += 1
        return httpx.Response(200, text="ok via proxy")

    pc = _make_client_with_mock_transport(direct, proxy_handler=proxy, max_retries=2)
    try:
        resp = await pc.get("https://example.com/blocked")
    finally:
        await pc.close()

    assert resp.status_code == 200
    assert resp.text == "ok via proxy"
    assert direct_hits == 1 and proxy_hits == 1


@pytest.mark.asyncio
async def test_403_fails_over_to_proxy():
    """A 403 (WAF/bot block) also triggers the proxy fail-over."""
    seen: list[str] = []

    def direct(request: httpx.Request) -> httpx.Response:
        seen.append("direct")
        return httpx.Response(403, text="forbidden")

    def proxy(request: httpx.Request) -> httpx.Response:
        seen.append("proxy")
        return httpx.Response(200, text="ok")

    pc = _make_client_with_mock_transport(direct, proxy_handler=proxy, max_retries=2)
    try:
        resp = await pc.get("https://example.com/blocked")
    finally:
        await pc.close()

    assert resp.status_code == 200
    assert seen == ["direct", "proxy"]


@pytest.mark.asyncio
async def test_5xx_does_not_fail_over_to_proxy():
    """A 503 is a server hiccup, not a per-IP block — the retry stays on the direct
    connection and the proxy is never touched (no wasted proxy bandwidth)."""
    proxy_touched = False

    def direct(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="unavailable")

    def proxy(request: httpx.Request) -> httpx.Response:
        nonlocal proxy_touched
        proxy_touched = True
        return httpx.Response(200, text="should not be used")

    pc = _make_client_with_mock_transport(direct, proxy_handler=proxy, max_retries=2)
    try:
        resp = await pc.get("https://example.com/down")
    finally:
        await pc.close()

    assert resp.status_code == 503  # exhausted on direct, returned
    assert proxy_touched is False, "5xx must not fail over to the proxy"


@pytest.mark.asyncio
async def test_proxy_failover_budget_caps_proxied_requests():
    """The per-run proxy budget bounds how many requests may use the proxy. With a
    budget of 1, a blocked vendor's first request fails over (recovers via proxy),
    but a second blocked request is over budget → stays direct and returns the block.
    This is the guard against a blocked high-volume vendor routing hundreds of
    fetches through the metered proxy."""
    proxy_hits = 0

    def direct(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="blocked")

    def proxy(request: httpx.Request) -> httpx.Response:
        nonlocal proxy_hits
        proxy_hits += 1
        return httpx.Response(200, text="ok via proxy")

    pc = _make_client_with_mock_transport(
        direct, proxy_handler=proxy, max_retries=2, max_proxy_failovers=1
    )
    try:
        first = await pc.get("https://example.com/a")   # fails over (budget 1/1)
        second = await pc.get("https://example.com/b")   # over budget → stays direct
    finally:
        await pc.close()

    assert first.status_code == 200      # recovered via proxy
    assert second.status_code == 429     # budget spent → direct → returns the block
    assert proxy_hits == 1               # the proxy was used exactly once


@pytest.mark.asyncio
async def test_no_proxy_configured_stays_direct_on_429():
    """With no proxy_fallback, a 429 just retries on the direct connection and
    returns the final 429 — the pre-proxy behavior, unchanged when the secret is
    unset."""
    attempts = 0

    def direct(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(429, text="slow down")

    pc = _make_client_with_mock_transport(direct, max_retries=2)  # no proxy_handler
    try:
        resp = await pc.get("https://example.com/throttled")
    finally:
        await pc.close()

    assert resp.status_code == 429
    assert attempts == 3  # initial + 2 retries, all direct


@pytest.mark.asyncio
async def test_persistent_503_returns_last_response_not_raises():
    """When 502/503/504 persists through every attempt, return the final error
    response (the scraper decides what to do) rather than raising."""
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(503, text="still down")

    pc = _make_client_with_mock_transport(handler, max_retries=2)
    try:
        resp = await pc.get("https://example.com/down")
    finally:
        await pc.close()

    assert resp.status_code == 503
    assert attempts == 3  # initial + 2 retries, then returned
