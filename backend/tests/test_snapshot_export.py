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
        "propellant", "delays", "delay_adjustable", "listings",
    }
    assert set(motor.keys()) >= expected_motor_keys
    assert motor["designation"] == "H242T-14A"
    assert motor["impulse_class"] == "H"
    assert motor["diameter_mm"] == 29
    assert motor["delay_adjustable"] is True  # critical — frontend reads as bool, not int
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
