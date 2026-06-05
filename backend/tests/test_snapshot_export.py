"""Golden-shape test for ``snapshot export`` — the only contract between the
backend and the Next.js frontend.

The shape is what `frontend/lib/snapshot.ts` types as ``Snapshot``. If a
field is renamed, removed, or its type changes, the frontend silently
breaks — these tests catch that at backend test-time.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
import typer

from hpr_finder import db
from hpr_finder.cli import snapshot_export
from hpr_finder.db import upsert_listings, upsert_motors, upsert_vendor
from hpr_finder.models import Listing, Motor, StockStatus


@pytest.fixture
def tmp_db(monkeypatch, tmp_path) -> Path:
    """Point ``db.connect()`` at a temp database for the duration of one test."""
    path = tmp_path / "hpr.db"
    monkeypatch.setattr(db, "DEFAULT_DB_PATH", path)
    return path


def _seed_minimal(db_path: Path) -> None:
    """One matched motor with one in-stock listing + one unmatched listing.
    Exercises every snapshot field including the unmatched bucket."""
    with db.connect(db_path) as conn:
        db.init_schema(conn)
        v_id = upsert_vendor(conn, slug="csrocketry", name="Chris' Rocket Supplies",
                             homepage="https://www.csrocketry.com", state="GA")
        upsert_motors(conn, [
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
        seen = datetime(2026, 5, 31, 12, 0, 0, tzinfo=UTC)
        upsert_listings(conn, v_id, [
            Listing(
                vendor_slug="csrocketry",
                motor_designation="H242T-14A",
                motor_id=None,  # find_motor_id will resolve via upsert
                url="https://www.csrocketry.com/product/h242t",
                sku="AT-H242T-14A",
                price_cents=4499,
                currency="USD",
                status=StockStatus.IN_STOCK_WITH_COUNT,
                stock_count=3,
                raw_title="AeroTech H242T-14A Blue Thunder Rocket Motor",
                seen_at=seen,
            ),
            Listing(
                vendor_slug="csrocketry",
                motor_designation="Z9999X-99",  # no catalog match
                motor_id=None,
                url="https://www.csrocketry.com/product/mystery",
                sku=None,
                price_cents=None,
                currency="USD",
                status=StockStatus.UNKNOWN,
                stock_count=None,
                raw_title="Mystery Item Z9999X-99",
                seen_at=seen,
            ),
        ])


def test_snapshot_shape_matches_frontend_contract(tmp_db, tmp_path):
    """Every key the frontend ``Snapshot`` type expects must be present
    with the right type. This is the single source-of-truth contract test."""
    _seed_minimal(tmp_db)
    out = tmp_path / "snap.json"
    snapshot_export(out=out)
    snap = json.loads(out.read_text())

    # Top-level shape
    assert set(snap.keys()) >= {"generated_at", "motors", "unmatched"}
    assert isinstance(snap["generated_at"], str)
    assert snap["generated_at"].endswith("+00:00"), "generated_at must be tz-aware ISO 8601"

    # Motors array
    assert isinstance(snap["motors"], list)
    assert len(snap["motors"]) == 1
    motor = snap["motors"][0]
    expected_motor_keys = {
        "id", "manufacturer", "designation", "common_name", "diameter_mm",
        "impulse_class", "total_impulse_ns", "avg_thrust_n", "burn_time_s",
        "propellant", "delays", "delay_adjustable", "discontinued", "listings",
    }
    assert set(motor.keys()) >= expected_motor_keys
    assert motor["designation"] == "H242T-14A"
    assert motor["impulse_class"] == "H"
    assert motor["diameter_mm"] == 29
    assert motor["delay_adjustable"] is True  # critical — frontend reads as bool, not int
    assert motor["discontinued"] is False  # a regular (in-production) motor
    assert motor["propellant"] == "Blue Thunder"

    # Listings nested under motor
    assert len(motor["listings"]) == 1
    listing = motor["listings"][0]
    expected_listing_keys = {
        "vendor_slug", "vendor_name", "url", "sku", "raw_designation",
        "price_cents", "currency", "status", "stock_count", "seen_at",
    }
    assert set(listing.keys()) >= expected_listing_keys
    assert listing["vendor_slug"] == "csrocketry"
    assert listing["vendor_name"] == "Chris' Rocket Supplies"
    assert listing["status"] == "in_stock_with_count"
    assert listing["price_cents"] == 4499
    assert listing["stock_count"] == 3

    # Unmatched bucket
    assert isinstance(snap["unmatched"], list)
    assert len(snap["unmatched"]) == 1
    um = snap["unmatched"][0]
    expected_unmatched_keys = {
        "raw_designation", "raw_title", "vendor_slug", "vendor_name", "url",
        "sku", "price_cents", "currency", "status", "stock_count", "seen_at",
    }
    assert set(um.keys()) >= expected_unmatched_keys
    assert um["raw_designation"] == "Z9999X-99"
    assert um["raw_title"] == "Mystery Item Z9999X-99"


def test_snapshot_status_enum_values(tmp_db, tmp_path):
    """Every StockStatus enum value must serialize to a string the frontend
    knows. frontend/lib/snapshot.ts only declares these 5 — if we add one
    to the enum we must update the frontend type."""
    _seed_minimal(tmp_db)
    out = tmp_path / "snap.json"
    snapshot_export(out=out)
    snap = json.loads(out.read_text())

    frontend_known_statuses = {
        "in_stock_with_count", "in_stock", "out_of_stock", "special_order", "unknown",
    }
    seen_statuses = {l["status"] for m in snap["motors"] for l in m["listings"]}
    seen_statuses |= {u["status"] for u in snap["unmatched"]}
    assert seen_statuses.issubset(frontend_known_statuses), (
        f"unknown status emitted: {seen_statuses - frontend_known_statuses} — "
        "frontend type needs updating"
    )


def test_snapshot_excludes_motors_without_listings(tmp_db, tmp_path):
    """Catalog motors with zero listings must NOT appear in the snapshot.

    This is the guard that keeps catalog-only motors (e.g. Cesaroni loaded
    before its scraper exists) out of snapshot.json. The frontend already
    hides listing-less motors, so emitting them is pure dead weight.
    """
    _seed_minimal(tmp_db)
    # Add a second motor that has NO listing — it should be filtered out.
    with db.connect(tmp_db) as conn:
        upsert_motors(conn, [
            Motor(
                manufacturer="Cesaroni Technology",
                designation="234I445-16A",
                common_name="I445",
                diameter_mm=38,
                length_mm=None,
                total_impulse_ns=234.0,
                avg_thrust_n=445.0,
                burn_time_s=None,
                propellant="White Thunder",
                impulse_class="I",
                delays="6,8,10,12,14,16",
                delay_adjustable=True,
                thrustcurve_id="cti-1",
            ),
        ])
    out = tmp_path / "snap.json"
    snapshot_export(out=out)
    snap = json.loads(out.read_text())

    designations = {m["designation"] for m in snap["motors"]}
    assert "H242T-14A" in designations          # has a listing → kept
    assert "234I445-16A" not in designations     # listing-less → excluded
    assert all(len(m["listings"]) > 0 for m in snap["motors"])


def test_snapshot_empty_db_produces_valid_shape(tmp_db, tmp_path):
    """Edge: fresh DB with no motors and no listings. Frontend must still
    be able to render an empty state."""
    with db.connect(tmp_db) as conn:
        db.init_schema(conn)
    out = tmp_path / "snap.json"
    snapshot_export(out=out)
    snap = json.loads(out.read_text())
    assert snap["motors"] == []
    assert snap["unmatched"] == []
    assert snap["generated_at"]


# --- health report (--report-json) for CI alerting -------------------------

def _prev_snapshot_with_csrocketry(n_listings: int) -> dict:
    """A previous snapshot carrying ``n_listings`` csrocketry listings on one
    motor — enough for carry_forward to treat csrocketry as recoverable."""
    return {
        "generated_at": "2026-05-31T11:00:00+00:00",
        "motors": [
            {
                "id": 1,
                "manufacturer": "AeroTech",
                "designation": "H242T-14A",
                "common_name": "H242",
                "diameter_mm": 29,
                "impulse_class": "H",
                "total_impulse_ns": 237.0,
                "avg_thrust_n": 242.0,
                "burn_time_s": 0.98,
                "propellant": "Blue Thunder",
                "delays": "6,10,14",
                "delay_adjustable": True,
                "listings": [
                    {
                        "vendor_slug": "csrocketry",
                        "vendor_name": "Chris' Rocket Supplies",
                        "url": f"https://www.csrocketry.com/p/{i}",
                        "sku": f"AT-{i}",
                        "price_cents": 4499,
                        "currency": "USD",
                        "status": "in_stock",
                        "stock_count": None,
                        "seen_at": "2026-05-31T11:00:00+00:00",
                        "raw_designation": "H242T-14A",
                    }
                    for i in range(n_listings)
                ],
            }
        ],
        "unmatched": [],
    }


def test_report_json_healthy_when_no_floor(tmp_db, tmp_path):
    """With floor disabled, every vendor is healthy and the report is not degraded."""
    _seed_minimal(tmp_db)
    out = tmp_path / "snap.json"
    report = tmp_path / "status.json"
    snapshot_export(out=out, report_json=report)

    status = json.loads(report.read_text())
    assert status["degraded"] is False
    assert status["carried"] == []
    assert status["failed"] == []
    assert status["decision"]["csrocketry"] == "healthy"


def test_report_json_flags_carried_vendor(tmp_db, tmp_path):
    """A vendor below floor but with prior data is 'carried' → degraded=True,
    and the snapshot still publishes (no exit)."""
    _seed_minimal(tmp_db)  # fresh csrocketry = 1 matched listing
    out = tmp_path / "snap.json"
    out.write_text(json.dumps(_prev_snapshot_with_csrocketry(3)))  # prior data exists
    report = tmp_path / "status.json"

    # floor=2 > fresh(1), prev(3) > 0  → carried, publishes normally.
    snapshot_export(out=out, floor=2, report_json=report)

    status = json.loads(report.read_text())
    assert status["degraded"] is True
    assert status["carried"] == ["csrocketry"]
    assert status["failed"] == []
    assert status["decision"]["csrocketry"] == "carried"
    # Carried data keeps its original (old) seen_at, so staleness is measurable
    # and positive — this is what the sustained-outage alert thresholds on.
    assert status["stale_hours"]["csrocketry"] is not None
    assert status["stale_hours"]["csrocketry"] > 0
    assert status["max_stale_hours"] == status["stale_hours"]["csrocketry"]


def test_report_json_written_even_on_refuse_to_publish(tmp_db, tmp_path):
    """A vendor below floor with NO prior data is 'failed' → export exits
    non-zero, but the health report is written FIRST so CI can still alert."""
    _seed_minimal(tmp_db)
    out = tmp_path / "snap.json"  # does not exist → no prev data
    report = tmp_path / "status.json"

    with pytest.raises(typer.Exit):
        snapshot_export(out=out, floor=2, report_json=report)

    status = json.loads(report.read_text())
    assert status["degraded"] is True
    assert "csrocketry" in status["failed"]
    assert status["decision"]["csrocketry"] == "failed"


def test_snapshot_marks_discontinued_oop_motor(tmp_db, tmp_path):
    """A motor matched to an out-of-production catalog entry is flagged
    ``discontinued`` so the UI can mark it as old stock that won't restock."""
    with db.connect(tmp_db) as conn:
        db.init_schema(conn)
        v_id = upsert_vendor(conn, slug="wildman", name="Wildman Rocketry",
                             homepage="https://wildman.test")
        upsert_motors(conn, [
            Motor(
                manufacturer="AeroTech", designation="E15W", common_name="E15",
                diameter_mm=29, length_mm=None, total_impulse_ns=None,
                avg_thrust_n=None, burn_time_s=None, propellant="White Lightning",
                impulse_class="E", delays=None, delay_adjustable=False,
                thrustcurve_id=None, availability="OOP",
            ),
        ])
        upsert_listings(conn, v_id, [
            Listing(
                vendor_slug="wildman", motor_designation="E15W", motor_id=None,
                url="https://wildman.test/e15", sku="E15", price_cents=1999,
                currency="USD", status=StockStatus.IN_STOCK, stock_count=None,
                raw_title="AeroTech E15 White Lightning", seen_at=datetime(2026, 5, 31, tzinfo=UTC),
            ),
        ])
    out = tmp_path / "snap.json"
    snapshot_export(out=out)
    snap = json.loads(out.read_text())
    e15 = next(m for m in snap["motors"] if m["designation"] == "E15W")
    assert e15["discontinued"] is True
