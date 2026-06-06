"""End-to-end pipeline test: scrape → normalize → SQLite → snapshot → history.

The unit suites each cover one stage in isolation (normalize matching, snapshot
shape, history events, …). This test wires the *real* CLI entry points together
through a fake in-memory vendor, exercising the exact hourly production flow —
``scrape run`` → ``snapshot export`` → ``history update`` — across two cycles so a
genuine out-of-stock → in-stock restock is observed end to end. It's the guard
that catches a field rename or contract drift *between* stages that per-stage
tests would each pass individually.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

import hpr_finder.cli as cli
import hpr_finder.db as db
from hpr_finder.models import Listing, Motor, StockStatus

_MATCHED_URL = "https://fake.test/p/h242t"
_UNMATCHED_URL = "https://fake.test/p/mystery"


class _FakeScraper:
    """A network-free vendor whose returned listings the test swaps between
    cycles. Mirrors the real Scraper protocol surface ``_async_scrape_run`` uses."""

    slug = "fake"
    name = "Fake Vendor"
    homepage = "https://fake.test"
    state = None
    max_concurrent_per_host = 4
    min_start_interval_s = 0.0
    listings: list[Listing] = []

    async def scrape(self, client, limit=None, only_urls=None):
        return list(type(self).listings)


def _seed_catalog(db_path: Path) -> None:
    """Load one canonical AeroTech motor so find_motor_id has something to match."""
    with db.connect(db_path) as conn:
        db.init_schema(conn)
        db.upsert_motors(conn, [
            Motor(
                manufacturer="AeroTech",
                designation="H242T-14A",
                common_name="H242",
                diameter_mm=29,
                length_mm=124,
                total_impulse_ns=237.0,
                avg_thrust_n=242.0,
                burn_time_s=0.98,
                propellant="Blue Thunder",
                impulse_class="H",
                delays="6,10,14",
                delay_adjustable=True,
                thrustcurve_id="abc123",
            ),
        ])


def _listing(status: StockStatus, seen: datetime, *, url: str = _MATCHED_URL,
             designation: str = "H242T-14A",
             title: str = "AeroTech H242T-14A Blue Thunder Rocket Motor",
             price: int | None = 4499) -> Listing:
    return Listing(
        vendor_slug="fake", motor_designation=designation, motor_id=None, url=url,
        sku="AT-H242T-14A", price_cents=price, currency="USD", status=status,
        stock_count=None, raw_title=title, seen_at=seen,
    )


@pytest.mark.asyncio
async def test_e2e_scrape_snapshot_history_restock(monkeypatch, tmp_path):
    db_path = tmp_path / "hpr.db"
    monkeypatch.setattr(db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(cli, "REGISTRY", {"fake": _FakeScraper})
    _seed_catalog(db_path)

    t1 = datetime(2026, 5, 31, 12, 0, 0, tzinfo=UTC)
    t2 = datetime(2026, 5, 31, 13, 0, 0, tzinfo=UTC)
    log = tmp_path / "history" / "log.json"
    summary = tmp_path / "history" / "summary.json"

    # ── Cycle 1: the motor is out of stock; a bogus product can't be matched. ──
    _FakeScraper.listings = [
        _listing(StockStatus.OUT_OF_STOCK, t1),
        _listing(StockStatus.UNKNOWN, t1, url=_UNMATCHED_URL, designation="Z9999X-99",
                 title="Mystery Item Z9999X-99", price=None),
    ]
    await cli._async_scrape_run("all", None, None, None, 0, None)

    snap1 = tmp_path / "snap1.json"
    cli.snapshot_export(out=snap1, floor=0)
    s1 = json.loads(snap1.read_text())

    # scrape → normalize → db: the real designation matched a catalog motor and
    # carries its listing; the bogus one landed in the unmatched bucket.
    assert [m["designation"] for m in s1["motors"]] == ["H242T-14A"]
    matched = s1["motors"][0]
    assert len(matched["listings"]) == 1
    assert matched["listings"][0]["status"] == "out_of_stock"
    assert {u["raw_designation"] for u in s1["unmatched"]} == {"Z9999X-99"}

    # snapshot → history: a first-seen out-of-stock listing, no restock yet.
    cli.history_update(snapshot_path=snap1, log=log, summary_out=summary)
    h1 = json.loads(summary.read_text())
    assert _MATCHED_URL in h1
    assert h1[_MATCHED_URL]["currently_in_stock"] is False
    assert h1[_MATCHED_URL]["restock_count"] == 0
    assert h1[_MATCHED_URL]["last_restock_at"] is None

    # ── Cycle 2: the same listing comes back IN STOCK — a genuine restock. ──
    _FakeScraper.listings = [_listing(StockStatus.IN_STOCK, t2)]
    await cli._async_scrape_run("all", None, None, None, 0, None)

    snap2 = tmp_path / "snap2.json"
    cli.snapshot_export(out=snap2, floor=0)
    s2 = json.loads(snap2.read_text())
    assert s2["motors"][0]["listings"][0]["status"] == "in_stock"

    cli.history_update(snapshot_path=snap2, log=log, summary_out=summary)
    h2 = json.loads(summary.read_text())
    # The out → in transition is recorded end to end as exactly one restock.
    assert h2[_MATCHED_URL]["currently_in_stock"] is True
    assert h2[_MATCHED_URL]["restock_count"] == 1
    assert h2[_MATCHED_URL]["last_restock_at"] == t2.isoformat()

    # The append-only event log retained both observations under the listing url.
    logged = json.loads(log.read_text())["listings"][_MATCHED_URL]["events"]
    assert [e["status"] for e in logged] == ["out_of_stock", "in_stock"]
