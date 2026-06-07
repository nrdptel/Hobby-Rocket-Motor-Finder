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
from hpr_finder.cli import (
    _categorize_scrape_error,
    _parse_iso,
    _vendor_stale_hours,
    snapshot_export,
)
from hpr_finder.db import (
    finish_run,
    start_run,
    upsert_listings,
    upsert_motors,
    upsert_vendor,
)
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
                motor_type="reload",
                case_info="RMS-29/240",
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
        "propellant", "delays", "delay_adjustable", "discontinued",
        "motor_type", "case_info", "listings",
    }
    assert set(motor.keys()) >= expected_motor_keys
    assert motor["designation"] == "H242T-14A"
    assert motor["impulse_class"] == "H"
    assert motor["diameter_mm"] == 29
    assert motor["delay_adjustable"] is True  # critical — frontend reads as bool, not int
    assert motor["discontinued"] is False  # a regular (in-production) motor
    assert motor["propellant"] == "Blue Thunder"
    assert motor["motor_type"] == "reload"
    assert motor["case_info"] == "RMS-29/240"

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


def test_snapshot_drops_out_of_scope_from_unmatched(tmp_db, tmp_path):
    """Out-of-scope lines (Q-Jet) must not land in the unmatched bucket — that
    would inflate the couldn't-identify count and the per-vendor unmatched-spike
    health metric forever — while a genuine unidentified motor still appears."""
    _seed_minimal(tmp_db)  # seeds one genuine unmatched listing (Z9999X-99)
    with db.connect(tmp_db) as conn:
        v_id = upsert_vendor(conn, slug="wildman", name="Wildman Rocketry",
                             homepage="https://wildmanrocketry.com", state="IL")
        upsert_listings(conn, v_id, [
            Listing(
                vendor_slug="wildman", motor_designation="B6-4", motor_id=None,
                url="https://wildmanrocketry.com/p/qjet-b6", sku=None, price_cents=1299,
                currency="USD", status=StockStatus.IN_STOCK, stock_count=None,
                raw_title="B6-4 Q-JET 2-pk", seen_at=datetime(2026, 5, 31, 12, 0, 0, tzinfo=UTC),
            ),
        ])
    out = tmp_path / "snap.json"
    snapshot_export(out=out)
    snap = json.loads(out.read_text())

    raws = {u["raw_designation"] for u in snap["unmatched"]}
    assert "Z9999X-99" in raws  # genuine unidentified motor is kept
    assert "B6-4" not in raws   # Q-Jet dropped
    assert not any("Q-JET" in (u["raw_title"] or "").upper() for u in snap["unmatched"])


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


def test_report_json_flags_zero_coverage_vendors(tmp_db, tmp_path):
    """A registered vendor that published no listings shows up in zero_coverage,
    while a vendor that did publish does not. Guards the silent blind spot where a
    blocked/non-matching vendor (e.g. erockets from CI IPs) would otherwise vanish
    from every count/staleness/anomaly check with no signal."""
    _seed_minimal(tmp_db)  # seeds csrocketry listings
    out = tmp_path / "snap.json"
    report = tmp_path / "status.json"
    snapshot_export(out=out, report_json=report)

    status = json.loads(report.read_text())
    # erockets is in the scraper REGISTRY but was never seeded → zero coverage.
    assert "erockets" in status["zero_coverage"]
    # csrocketry published listings → not flagged.
    assert "csrocketry" not in status["zero_coverage"]


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


def test_below_floor_new_vendor_publishes_but_is_flagged(tmp_db, tmp_path):
    """A vendor below floor with NO prior data is 'failed' in the report, but it
    must NOT block publishing: it keeps its partial fresh data and the snapshot
    is written (no exit), so one struggling new vendor can't take the site
    offline. The health report still flags it for alerting."""
    _seed_minimal(tmp_db)
    out = tmp_path / "snap.json"  # does not exist → no prev data
    report = tmp_path / "status.json"

    # Does not raise — the snapshot has listings, so it publishes.
    snapshot_export(out=out, floor=2, report_json=report)

    status = json.loads(report.read_text())
    assert status["degraded"] is True
    assert "csrocketry" in status["failed"]
    assert status["decision"]["csrocketry"] == "failed"
    # The partial data is published, not discarded.
    snap = json.loads(out.read_text())
    assert any(m["listings"] for m in snap["motors"])


def test_report_records_baseline_and_no_anomaly_on_healthy_run(tmp_db, tmp_path):
    """A healthy run warms the per-vendor baseline and reports no anomalies."""
    _seed_minimal(tmp_db)  # csrocketry: 1 matched in-stock listing
    out = tmp_path / "snap.json"
    report = tmp_path / "status.json"
    baseline = tmp_path / "baseline.json"

    snapshot_export(out=out, report_json=report, baseline_json=baseline)

    status = json.loads(report.read_text())
    assert status["anomalies"] == []
    assert status["anomaly_sustained"] is False
    b = json.loads(baseline.read_text())
    assert b["csrocketry"]["samples"] == 1
    assert b["csrocketry"]["count"] == 1.0


def test_report_flags_below_baseline_anomaly(tmp_db, tmp_path):
    """A vendor far below its established baseline is flagged — and with a primed
    streak it escalates to anomaly_sustained, even though it's 'healthy' (floor 0)."""
    _seed_minimal(tmp_db)  # fresh csrocketry = 1 listing
    out = tmp_path / "snap.json"
    report = tmp_path / "status.json"
    baseline = tmp_path / "baseline.json"
    # Pre-seed a high, mature baseline + a streak of 2, so this 1-listing run is
    # well below baseline and tips the streak to the escalation threshold (3).
    baseline.write_text(
        json.dumps({"csrocketry": {"count": 600.0, "stock": 200.0, "samples": 10, "streak": 2}})
    )

    snapshot_export(out=out, report_json=report, baseline_json=baseline)

    status = json.loads(report.read_text())
    assert len(status["anomalies"]) == 1
    assert status["anomalies"][0]["vendor"] == "csrocketry"
    assert status["anomalies"][0]["streak"] == 3
    assert status["anomaly_sustained"] is True
    # The baseline value must NOT be dragged down by the anomalous run.
    b = json.loads(baseline.read_text())
    assert b["csrocketry"]["count"] == 600.0


def _record_finished_run(
    db_path: Path, slug: str, started: str, finished: str,
    ok: bool = True, error: str | None = None,
) -> None:
    """Record one finished scrape_runs row for an already-seeded vendor."""
    with db.connect(db_path) as conn:
        v_id = upsert_vendor(conn, slug=slug, name=slug, homepage=f"https://{slug}", state=None)
        run_id = start_run(conn, v_id, started)
        finish_run(conn, run_id, finished, ok=ok, listings_seen=1, error=error)


def test_report_includes_run_durations(tmp_db, tmp_path):
    """A vendor with a finished scrape run gets a per-vendor duration in the report."""
    _seed_minimal(tmp_db)  # creates the csrocketry vendor + listings
    _record_finished_run(tmp_db, "csrocketry", "2026-05-31T12:00:00", "2026-05-31T12:00:42")
    out = tmp_path / "snap.json"
    report = tmp_path / "status.json"

    snapshot_export(out=out, report_json=report)

    status = json.loads(report.read_text())
    assert status["run_durations"]["csrocketry"] == 42.0
    assert status["max_run_seconds"] == 42.0
    assert status["no_finished_run"] == []  # nothing hung


def test_report_flags_vendor_with_no_finished_run(tmp_db, tmp_path):
    """A vendor present this run but with no finished scrape run (hung/crashed
    before finish_run) is absent from run_durations and listed in no_finished_run,
    not given a bogus duration."""
    _seed_minimal(tmp_db)  # csrocketry has listings but no scrape_runs row
    out = tmp_path / "snap.json"
    report = tmp_path / "status.json"

    snapshot_export(out=out, report_json=report)

    status = json.loads(report.read_text())
    assert "csrocketry" not in status["run_durations"]
    assert status["no_finished_run"] == ["csrocketry"]
    assert status["max_run_seconds"] == 0.0


@pytest.mark.parametrize(
    "err, expected",
    [
        (None, "none"),
        ("", "none"),
        ("ReadTimeout('timed out')", "timeout"),
        ("ConnectError('Connection reset by peer')", "connection"),
        ("SSLError('handshake failed')", "connection"),
        ("HTTPStatusError('429 Too Many Requests')", "http"),
        ("RuntimeError('blocked from CI data-center IP')", "http"),
        ("KeyError('price')", "parse"),
        ("JSONDecodeError('Expecting value')", "parse"),
        ("ValueError('something weird')", "other"),
    ],
)
def test_categorize_scrape_error(err, expected):
    assert _categorize_scrape_error(err) == expected


def test_report_includes_categorized_scrape_error(tmp_db, tmp_path):
    """A vendor whose latest finished run FAILED surfaces a categorized last error."""
    _seed_minimal(tmp_db)
    _record_finished_run(
        tmp_db, "csrocketry", "2026-05-31T12:00:00", "2026-05-31T12:00:05",
        ok=False, error="ConnectTimeout('timed out')",
    )
    out = tmp_path / "snap.json"
    report = tmp_path / "status.json"

    snapshot_export(out=out, report_json=report)

    status = json.loads(report.read_text())
    assert status["scrape_errors"]["csrocketry"]["category"] == "timeout"
    assert "timed out" in status["scrape_errors"]["csrocketry"]["detail"]


def test_report_no_scrape_error_on_successful_run(tmp_db, tmp_path):
    """A healthy (ok) finished run records no entry in scrape_errors."""
    _seed_minimal(tmp_db)
    _record_finished_run(tmp_db, "csrocketry", "2026-05-31T12:00:00", "2026-05-31T12:00:05")
    out = tmp_path / "snap.json"
    report = tmp_path / "status.json"

    snapshot_export(out=out, report_json=report)

    status = json.loads(report.read_text())
    assert status["scrape_errors"] == {}


def _seed_matched_plus_unmatched(db_path: Path, n_unmatched: int) -> None:
    """csrocketry with one matched in-stock listing and ``n_unmatched`` listings
    whose designation has no catalog match. Lets a test drive the unmatched-spike
    rule while the matched count stays healthy."""
    with db.connect(db_path) as conn:
        db.init_schema(conn)
        v_id = upsert_vendor(conn, slug="csrocketry", name="Chris' Rocket Supplies",
                             homepage="https://www.csrocketry.com", state="GA")
        upsert_motors(conn, [
            Motor(
                manufacturer="AeroTech", designation="H242T-14A", common_name="H242",
                diameter_mm=29, length_mm=124, total_impulse_ns=237.0, avg_thrust_n=242.0,
                burn_time_s=0.98, propellant="Blue Thunder", impulse_class="H",
                delays="6,10,14", delay_adjustable=True, thrustcurve_id="abc123",
            ),
        ])
        seen = datetime(2026, 5, 31, 12, 0, 0, tzinfo=UTC)
        listings = [
            Listing(
                vendor_slug="csrocketry", motor_designation="H242T-14A", motor_id=None,
                url="https://www.csrocketry.com/product/h242t", sku="AT-H242T-14A",
                price_cents=4499, currency="USD", status=StockStatus.IN_STOCK_WITH_COUNT,
                stock_count=3, raw_title="AeroTech H242T-14A Blue Thunder Rocket Motor",
                seen_at=seen,
            ),
        ]
        for i in range(n_unmatched):
            listings.append(Listing(
                vendor_slug="csrocketry", motor_designation=f"Z{9000 + i}X-99", motor_id=None,
                url=f"https://www.csrocketry.com/product/mystery-{i}", sku=None,
                price_cents=None, currency="USD", status=StockStatus.UNKNOWN,
                stock_count=None, raw_title=f"Mystery Item Z{9000 + i}X-99", seen_at=seen,
            ))
        upsert_listings(conn, v_id, listings)


def test_report_flags_unmatched_spike_anomaly(tmp_db, tmp_path):
    """Match-rate erosion: the matched count stays healthy (count/in-stock rules
    silent) but unmatched spikes far above baseline → flagged, and with a primed
    streak it escalates to anomaly_sustained."""
    _seed_matched_plus_unmatched(tmp_db, n_unmatched=25)
    out = tmp_path / "snap.json"
    report = tmp_path / "status.json"
    baseline = tmp_path / "baseline.json"
    # Low matched baseline (so 1 matched listing is fine) + a low unmatched baseline
    # (8) and a streak of 2, so 25 unmatched tips the streak to escalation (3).
    baseline.write_text(json.dumps({
        "csrocketry": {"count": 1.0, "stock": 1.0, "unmatched": 8.0, "samples": 10, "streak": 2}
    }))

    snapshot_export(out=out, report_json=report, baseline_json=baseline)

    status = json.loads(report.read_text())
    assert status["fresh_unmatched"]["csrocketry"] == 25
    assert len(status["anomalies"]) == 1
    an = status["anomalies"][0]
    assert an["vendor"] == "csrocketry"
    assert any("unmatched" in r for r in an["reasons"])
    assert not any("listings" in r or "in-stock" in r for r in an["reasons"])
    assert an["streak"] == 3
    assert status["anomaly_sustained"] is True
    # The unmatched baseline must NOT be dragged up by the anomalous run.
    b = json.loads(baseline.read_text())
    assert b["csrocketry"]["unmatched"] == 8.0


def test_report_healthy_run_seeds_unmatched_baseline(tmp_db, tmp_path):
    """A healthy run records the per-vendor unmatched count into the baseline so the
    metric warms up alongside count/stock."""
    _seed_matched_plus_unmatched(tmp_db, n_unmatched=4)
    out = tmp_path / "snap.json"
    report = tmp_path / "status.json"
    baseline = tmp_path / "baseline.json"

    snapshot_export(out=out, report_json=report, baseline_json=baseline)

    b = json.loads(baseline.read_text())
    assert b["csrocketry"]["unmatched"] == 4.0
    assert b["csrocketry"]["samples"] == 1
    status = json.loads(report.read_text())
    assert status["fresh_unmatched"]["csrocketry"] == 4
    assert status["anomalies"] == []  # no baseline yet to spike against


def test_parse_iso_normalizes_naive_to_utc():
    # A naive timestamp (carried forward from an early archived snapshot) must
    # become tz-aware so the stale-hours subtraction can't raise TypeError.
    aware = _parse_iso("2026-06-01T00:00:00+00:00")
    naive = _parse_iso("2026-06-01T00:00:00")  # no offset
    assert aware is not None and naive is not None
    assert naive.tzinfo is not None
    # Mixing the two in a subtraction (what _vendor_stale_hours does) must work.
    assert (aware - naive).total_seconds() == 0


def test_vendor_stale_hours_survives_naive_seen_at():
    # generated_at aware, a carried listing's seen_at naive — must not crash.
    payload = {
        "generated_at": "2026-06-02T00:00:00+00:00",
        "motors": [
            {
                "manufacturer": "AeroTech", "designation": "H1",
                "listings": [
                    {"vendor_slug": "amw", "seen_at": "2026-06-01T00:00:00"},  # naive
                ],
            }
        ],
    }
    out = _vendor_stale_hours(payload, {"amw": "carried"})
    assert out["amw"] == 24.0  # 1 day gap, computed without raising


def test_refuses_to_publish_empty_snapshot_under_floor(tmp_db, tmp_path):
    """With a floor set (production path), a snapshot with zero motor listings —
    e.g. a broken catalog left everything unmatched — must refuse to publish so
    a blank snapshot never overwrites good committed data."""
    with db.connect(tmp_db) as conn:
        db.init_schema(conn)  # empty DB → no motors, no listings
    out = tmp_path / "snap.json"
    with pytest.raises(typer.Exit):
        snapshot_export(out=out, floor=200)


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
