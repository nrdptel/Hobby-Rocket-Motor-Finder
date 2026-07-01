"""Tests for ``db.rematch_listings`` — re-derives each stored listing's
designation from its title with the CURRENT parser and re-matches ``motor_id``.

This backs the ``catalog rematch`` CLI: when the normalization regex is
improved, listings already stored under the old parser must pick up the
corrected designation and motor link WITHOUT waiting for a fresh scrape. The
function walks every listing, re-runs the manufacturer-appropriate extractor
(AeroTech vs Cesaroni), updates the stored ``raw_designation`` when it changes,
re-matches ``motor_id``, and returns ``(designations_updated, motors_rematched,
total)``. These cases pin that contract, including that it counts only genuine
changes (so a no-op rematch reports zeros) and routes Cesaroni titles through
the CTI extractor.
"""
from __future__ import annotations

import sqlite3

import pytest

from hpr_finder.db import (
    find_motor_id,
    init_schema,
    rematch_listings,
    upsert_motors,
    upsert_vendor,
)
from hpr_finder.models import Motor
from hpr_finder.normalize import extract_cti_designation, extract_designation


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    init_schema(c)
    yield c
    c.close()


def _motor(manufacturer: str, designation: str, diameter_mm: int = 29, impulse_class: str = "H") -> Motor:
    return Motor(
        manufacturer=manufacturer,
        designation=designation,
        common_name=designation,
        diameter_mm=diameter_mm,
        length_mm=None,
        total_impulse_ns=None,
        avg_thrust_n=None,
        burn_time_s=None,
        propellant=None,
        impulse_class=impulse_class,
        delays=None,
        delay_adjustable=False,
        thrustcurve_id=None,
        availability=None,
    )


def _insert_listing(
    conn: sqlite3.Connection,
    vendor_id: int,
    *,
    raw_designation: str,
    raw_title: str,
    motor_id: int | None,
    manufacturer: str = "AeroTech",
    diameter_mm: int | None = None,
    url: str = "https://vendor.example/x",
) -> int:
    """Insert a listing row directly (bypassing upsert_listings' own matching)
    so a genuinely STALE pre-parser-update state can be reproduced."""
    conn.execute(
        "INSERT INTO listings (vendor_id, motor_id, raw_designation, raw_title, url, sku, "
        "price_cents, currency, status, stock_count, manufacturer, diameter_mm, lead_time, seen_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (vendor_id, motor_id, raw_designation, raw_title, url, None, 1000, "USD",
         "in_stock", None, manufacturer, diameter_mm, None, "2026-06-01T00:00:00"),
    )
    conn.commit()
    return conn.execute("SELECT id FROM listings WHERE url = ?", (url,)).fetchone()["id"]


def test_rematch_updates_stale_designation_and_motor_id(conn):
    v = upsert_vendor(conn, slug="wildman", name="Wildman", homepage="https://w")
    title = "AeroTech H128W-14A White Lightning 29mm Reload"
    correct = extract_designation(title)
    assert correct, "parser should extract a designation from the title"
    upsert_motors(conn, [_motor("AeroTech", correct, diameter_mm=29)])
    target_id = find_motor_id(conn, "AeroTech", correct, title, 29)
    assert target_id is not None

    # Stored under an OLD parser: junk designation, never matched.
    lid = _insert_listing(
        conn, v, raw_designation="OLD-JUNK", raw_title=title, motor_id=None, diameter_mm=29
    )

    des_changed, motor_changed, total = rematch_listings(conn)
    assert (des_changed, motor_changed, total) == (1, 1, 1)

    row = conn.execute(
        "SELECT raw_designation, motor_id FROM listings WHERE id = ?", (lid,)
    ).fetchone()
    assert row["raw_designation"] == correct
    assert row["motor_id"] == target_id


def test_rematch_counts_only_real_changes_and_is_idempotent(conn):
    v = upsert_vendor(conn, slug="wildman", name="Wildman", homepage="https://w")
    title = "AeroTech J350W-14A 38mm Reload"
    correct = extract_designation(title)
    upsert_motors(conn, [_motor("AeroTech", correct, diameter_mm=38, impulse_class="J")])
    target_id = find_motor_id(conn, "AeroTech", correct, title, 38)

    # Already-correct: designation matches the current parser, motor_id set.
    _insert_listing(
        conn, v, raw_designation=correct, raw_title=title, motor_id=target_id,
        diameter_mm=38, url="https://vendor.example/ok",
    )

    # First pass: nothing to change (it's already right).
    assert rematch_listings(conn) == (0, 0, 1)
    # Idempotent: a second pass is still a no-op.
    assert rematch_listings(conn) == (0, 0, 1)


def test_rematch_routes_cesaroni_titles_through_the_cti_extractor(conn):
    v = upsert_vendor(conn, slug="csrocketry", name="Chris'", homepage="https://c")
    # CTI grammar differs from AeroTech; rematch must pick the CTI extractor for a
    # "cesaroni…" manufacturer. Its output (I170) differs from what the AeroTech
    # extractor would return for the same title, so a correct result proves routing.
    title = "Cesaroni I170-14A Classic Rocket Motor"
    correct = extract_cti_designation(title)
    assert correct == "I170"
    assert extract_designation(title) != correct  # the two extractors disagree here
    upsert_motors(conn, [_motor("Cesaroni Technology", correct, diameter_mm=38, impulse_class="I")])
    target_id = find_motor_id(conn, "Cesaroni Technology", correct, title, 38)
    assert target_id is not None

    lid = _insert_listing(
        conn, v, raw_designation="STALE", raw_title=title, motor_id=None,
        manufacturer="Cesaroni Technology", diameter_mm=38,
    )

    des_changed, motor_changed, total = rematch_listings(conn)
    assert (des_changed, motor_changed, total) == (1, 1, 1)
    row = conn.execute(
        "SELECT raw_designation, motor_id FROM listings WHERE id = ?", (lid,)
    ).fetchone()
    assert row["raw_designation"] == "I170"
    assert row["motor_id"] == target_id
