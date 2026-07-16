"""Tests for the ``scrape run all`` orchestration.

The contract these protect: one vendor failing (timeout, connection reset,
blocked CI IP) must NOT cancel its in-flight siblings or abort the whole run.
A partial scrape still feeds the snapshot's per-vendor carry-forward, so the
command only exits non-zero when EVERY vendor fails.
"""
from __future__ import annotations

import pytest
import typer

import hpr_finder.cli as cli
import hpr_finder.db as db


class _OkScraper:
    slug = "ok"
    name = "OK Vendor"
    homepage = "https://ok.test"
    state = None
    max_concurrent_per_host = 4
    min_start_interval_s = 0.0

    async def scrape(self, client, limit=None, only_urls=None):
        return []  # healthy run, zero listings is fine for orchestration


class _BoomScraper:
    slug = "boom"
    name = "Boom Vendor"
    homepage = "https://boom.test"
    state = None
    max_concurrent_per_host = 4
    min_start_interval_s = 0.0

    async def scrape(self, client, limit=None, only_urls=None):
        raise RuntimeError("blocked from CI data-center IP")


class _Boom2Scraper(_BoomScraper):
    slug = "boom2"
    name = "Boom Vendor 2"
    homepage = "https://boom2.test"


def _run_states(db_path) -> dict[str, int]:
    with db.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT v.slug AS slug, sr.ok AS ok "
            "FROM scrape_runs sr JOIN vendors v ON v.id = sr.vendor_id"
        ).fetchall()
    return {r["slug"]: r["ok"] for r in rows}


@pytest.mark.asyncio
async def test_scrape_all_isolates_one_vendor_failure(monkeypatch, tmp_path):
    """A failing vendor records ok=0 but the healthy vendor still records ok=1,
    and the command does NOT raise — the partial result publishes."""
    db_path = tmp_path / "hpr.db"
    monkeypatch.setattr(db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(cli, "REGISTRY", {"ok": _OkScraper, "boom": _BoomScraper})

    # Must complete without raising — one vendor succeeded.
    await cli._async_scrape_run("all", None, None, None, 0, None)

    states = _run_states(db_path)
    assert states["ok"] == 1, "healthy vendor should be recorded successful"
    assert states["boom"] == 0, "failed vendor should be recorded failed, not crash the run"


class _ProxiedScraper(_OkScraper):
    slug = "proxied"
    name = "Proxied Vendor"
    use_proxy = True


class _DirectScraper(_OkScraper):
    slug = "direct"
    name = "Direct Vendor"
    use_proxy = False


@pytest.mark.asyncio
async def test_proxy_routed_only_for_opted_in_vendors(monkeypatch, tmp_path):
    """With SCRAPER_PROXY_URL set, a use_proxy vendor's client is built with the
    proxy URL and a non-opted-in vendor's client is built with proxy=None — so
    only the blocked vendors go through the proxy, everyone else stays direct."""
    db_path = tmp_path / "hpr.db"
    monkeypatch.setattr(db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(cli, "REGISTRY", {"proxied": _ProxiedScraper, "direct": _DirectScraper})
    monkeypatch.setenv("SCRAPER_PROXY_URL", "http://user:pass@gw.example:823")

    seen: list[str | None] = []
    real = cli.polite_async_client

    def spy(*args, proxy=None, **kwargs):
        seen.append(proxy)
        return real(*args, proxy=proxy, **kwargs)

    monkeypatch.setattr(cli, "polite_async_client", spy)

    await cli._async_scrape_run("all", None, None, None, 0, None)

    # One client was built WITH the proxy URL (the opted-in vendor), one with None.
    assert "http://user:pass@gw.example:823" in seen
    assert None in seen
    assert len(seen) == 2


@pytest.mark.asyncio
async def test_no_proxy_when_secret_unset(monkeypatch, tmp_path):
    """Even a use_proxy vendor scrapes direct when the secret isn't set — the
    feature is inert until a proxy is configured."""
    db_path = tmp_path / "hpr.db"
    monkeypatch.setattr(db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(cli, "REGISTRY", {"proxied": _ProxiedScraper})
    monkeypatch.delenv("SCRAPER_PROXY_URL", raising=False)

    seen: list[str | None] = []
    real = cli.polite_async_client

    def spy(*args, proxy=None, **kwargs):
        seen.append(proxy)
        return real(*args, proxy=proxy, **kwargs)

    monkeypatch.setattr(cli, "polite_async_client", spy)

    await cli._async_scrape_run("all", None, None, None, 0, None)
    assert seen == [None]


@pytest.mark.asyncio
async def test_scrape_all_exits_when_every_vendor_fails(monkeypatch, tmp_path):
    """If no vendor succeeds there's nothing to publish, so the command exits
    non-zero (CI surfaces the failure)."""
    db_path = tmp_path / "hpr.db"
    monkeypatch.setattr(db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(cli, "REGISTRY", {"boom": _BoomScraper, "boom2": _Boom2Scraper})

    with pytest.raises(typer.Exit):
        await cli._async_scrape_run("all", None, None, None, 0, None)

    states = _run_states(db_path)
    assert states == {"boom": 0, "boom2": 0}
