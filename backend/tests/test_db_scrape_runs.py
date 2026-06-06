"""Tests for ``db.latest_finished_runs`` — the per-vendor latest finished scrape
run used to surface scrape duration in the health report.

Contract: one row per vendor, the most recent FINISHED run (by started_at), with
still-running/crashed runs (finished_at IS NULL) excluded so a hung scraper shows
up as an absent vendor rather than a bogus duration.
"""
from __future__ import annotations

import sqlite3

import pytest

from hpr_finder.db import (
    finish_run,
    init_schema,
    latest_finished_runs,
    start_run,
    upsert_vendor,
)


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    init_schema(c)
    yield c
    c.close()


def test_latest_finished_runs_picks_latest_per_vendor(conn):
    v = upsert_vendor(conn, slug="csrocketry", name="Chris'", homepage="https://x", state="GA")
    # An older finished run, then a newer one — the newer should win.
    r1 = start_run(conn, v, "2026-05-31T12:00:00")
    finish_run(conn, r1, "2026-05-31T12:00:30", ok=True, listings_seen=100)
    r2 = start_run(conn, v, "2026-05-31T13:00:00")
    finish_run(conn, r2, "2026-05-31T13:00:42", ok=True, listings_seen=110)

    rows = latest_finished_runs(conn)
    assert len(rows) == 1
    row = rows[0]
    assert row["vendor_slug"] == "csrocketry"
    assert row["started_at"] == "2026-05-31T13:00:00"
    assert row["finished_at"] == "2026-05-31T13:00:42"
    assert row["listings_seen"] == 110


def test_latest_finished_runs_excludes_unfinished(conn):
    v = upsert_vendor(conn, slug="wildman", name="Wildman", homepage="https://x", state="IL")
    # A finished run, then a newer run that never finished (hung / crashed).
    r1 = start_run(conn, v, "2026-05-31T12:00:00")
    finish_run(conn, r1, "2026-05-31T12:00:20", ok=True, listings_seen=50)
    start_run(conn, v, "2026-05-31T13:00:00")  # no finish_run → finished_at NULL

    rows = latest_finished_runs(conn)
    # The unfinished run is ignored; the latest FINISHED run is returned.
    assert len(rows) == 1
    assert rows[0]["finished_at"] == "2026-05-31T12:00:20"


def test_latest_finished_runs_one_row_per_vendor(conn):
    a = upsert_vendor(conn, slug="a", name="A", homepage="https://a", state=None)
    b = upsert_vendor(conn, slug="b", name="B", homepage="https://b", state=None)
    for vid, t in ((a, "12:00"), (b, "12:01")):
        rid = start_run(conn, vid, f"2026-05-31T{t}:00")
        finish_run(conn, rid, f"2026-05-31T{t}:10", ok=True, listings_seen=1)

    rows = latest_finished_runs(conn)
    assert {r["vendor_slug"] for r in rows} == {"a", "b"}


def test_latest_finished_runs_empty_when_no_finished_runs(conn):
    v = upsert_vendor(conn, slug="x", name="X", homepage="https://x", state=None)
    start_run(conn, v, "2026-05-31T12:00:00")  # started but never finished
    assert latest_finished_runs(conn) == []
