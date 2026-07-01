"""Tests for the pure stock/price history module.

Build snapshot dicts directly (no git, no DB) in the style of
test_snapshot_carry_forward.py. Every test targets a pure function in
hpr_finder.history.
"""
from __future__ import annotations

from hpr_finder import history


def _listing(url: str, status: str, price_cents: int | None, seen_at: str, vendor="csrocketry") -> dict:
    return {
        "url": url,
        "vendor_slug": vendor,
        "status": status,
        "price_cents": price_cents,
        "seen_at": seen_at,
    }


def _snap(generated_at: str, listings: list[dict], unmatched: list[dict] | None = None) -> dict:
    return {
        "generated_at": generated_at,
        "motors": [{"id": 1, "designation": "X", "listings": listings}],
        "unmatched": unmatched or [],
    }


# --- is_in_stock ------------------------------------------------------------

def test_is_in_stock_mapping():
    assert history.is_in_stock("in_stock") is True
    assert history.is_in_stock("in_stock_with_count") is True
    assert history.is_in_stock("out_of_stock") is False
    assert history.is_in_stock("special_order") is False
    assert history.is_in_stock("unknown") is False
    assert history.is_in_stock(None) is False


# --- apply_snapshot ---------------------------------------------------------

def test_apply_snapshot_first_event_per_listing():
    snap = _snap("2026-06-01T00:00:00+00:00", [
        _listing("u1", "in_stock", 1500, "2026-06-01T00:00:00+00:00"),
    ])
    log = history.apply_snapshot(history.empty_log(), snap)
    events = log["listings"]["u1"]["events"]
    assert events == [{"t": "2026-06-01T00:00:00+00:00", "status": "in_stock", "price_cents": 1500}]
    assert log["updated_at"] == "2026-06-01T00:00:00+00:00"
    assert log["listings"]["u1"]["vendor_slug"] == "csrocketry"


def test_apply_snapshot_idempotent():
    snap = _snap("2026-06-01T00:00:00+00:00", [_listing("u1", "in_stock", 1500, "2026-06-01T00:00:00+00:00")])
    once = history.apply_snapshot(history.empty_log(), snap)
    twice = history.apply_snapshot(once, snap)
    assert twice == once  # no new event on re-apply


def test_apply_snapshot_does_not_mutate_input_log():
    snap1 = _snap("2026-06-01T00:00:00+00:00", [_listing("u1", "out_of_stock", 1500, "2026-06-01T00:00:00+00:00")])
    log1 = history.apply_snapshot(history.empty_log(), snap1)
    snap2 = _snap("2026-06-01T01:00:00+00:00", [_listing("u1", "in_stock", 1500, "2026-06-01T01:00:00+00:00")])
    history.apply_snapshot(log1, snap2)
    # log1 must be unchanged (still a single event).
    assert len(log1["listings"]["u1"]["events"]) == 1


def test_apply_snapshot_status_change_appends_one_event():
    log = history.empty_log()
    log = history.apply_snapshot(log, _snap("2026-06-01T00:00:00+00:00", [_listing("u1", "out_of_stock", 1500, "2026-06-01T00:00:00+00:00")]))
    log = history.apply_snapshot(log, _snap("2026-06-01T01:00:00+00:00", [_listing("u1", "in_stock", 1500, "2026-06-01T01:00:00+00:00")]))
    events = log["listings"]["u1"]["events"]
    assert [e["status"] for e in events] == ["out_of_stock", "in_stock"]


def test_apply_snapshot_price_change_appends_event():
    log = history.empty_log()
    log = history.apply_snapshot(log, _snap("2026-06-01T00:00:00+00:00", [_listing("u1", "in_stock", 1500, "2026-06-01T00:00:00+00:00")]))
    log = history.apply_snapshot(log, _snap("2026-06-01T01:00:00+00:00", [_listing("u1", "in_stock", 1800, "2026-06-01T01:00:00+00:00")]))
    assert [e["price_cents"] for e in log["listings"]["u1"]["events"]] == [1500, 1800]


def test_apply_snapshot_price_to_null_and_back():
    log = history.empty_log()
    log = history.apply_snapshot(log, _snap("2026-06-01T00:00:00+00:00", [_listing("u1", "in_stock", 1500, "2026-06-01T00:00:00+00:00")]))
    log = history.apply_snapshot(log, _snap("2026-06-01T01:00:00+00:00", [_listing("u1", "in_stock", None, "2026-06-01T01:00:00+00:00")]))
    log = history.apply_snapshot(log, _snap("2026-06-01T02:00:00+00:00", [_listing("u1", "in_stock", 1500, "2026-06-01T02:00:00+00:00")]))
    assert [e["price_cents"] for e in log["listings"]["u1"]["events"]] == [1500, None, 1500]


def test_apply_snapshot_in_stock_variants_are_events_but_not_restock():
    log = history.empty_log()
    log = history.apply_snapshot(log, _snap("2026-06-01T00:00:00+00:00", [_listing("u1", "in_stock", 1500, "2026-06-01T00:00:00+00:00")]))
    log = history.apply_snapshot(log, _snap("2026-06-01T01:00:00+00:00", [_listing("u1", "in_stock_with_count", 1500, "2026-06-01T01:00:00+00:00")]))
    # Two events (raw status changed) ...
    assert len(log["listings"]["u1"]["events"]) == 2
    # ... but ZERO restocks: the first appearance isn't a restock, and a flip
    # between the two in-stock statuses keeps is_in_stock True throughout.
    summary = history.summarize(log, "2026-06-01T02:00:00+00:00")
    assert summary["u1"]["restock_count"] == 0


def test_apply_snapshot_carry_forward_identical_records_nothing():
    """A carried (re-published, byte-identical) listing keeps its old seen_at and
    state, so no event is recorded."""
    listing = _listing("u1", "in_stock", 1500, "2026-06-01T00:00:00+00:00")
    log = history.apply_snapshot(history.empty_log(), _snap("2026-06-01T00:00:00+00:00", [listing]))
    # Next run: snapshot generated later, but the listing is carried unchanged.
    log = history.apply_snapshot(log, _snap("2026-06-01T01:00:00+00:00", [dict(listing)]))
    assert len(log["listings"]["u1"]["events"]) == 1


def test_apply_snapshot_seen_at_falls_back_to_generated_at():
    listing = {"url": "u1", "vendor_slug": "v", "status": "in_stock", "price_cents": 1500}  # no seen_at
    log = history.apply_snapshot(history.empty_log(), _snap("2026-06-01T00:00:00+00:00", [listing]))
    assert log["listings"]["u1"]["events"][0]["t"] == "2026-06-01T00:00:00+00:00"


def test_apply_snapshot_absent_listing_untouched():
    log = history.empty_log()
    log = history.apply_snapshot(log, _snap("2026-06-01T00:00:00+00:00", [_listing("u1", "in_stock", 1500, "2026-06-01T00:00:00+00:00")]))
    # u1 absent from this snapshot; only u2 present.
    log = history.apply_snapshot(log, _snap("2026-06-01T01:00:00+00:00", [_listing("u2", "in_stock", 999, "2026-06-01T01:00:00+00:00")]))
    assert len(log["listings"]["u1"]["events"]) == 1  # frozen, no delist event
    assert "u2" in log["listings"]


def test_apply_snapshot_reads_unmatched_listings():
    snap = _snap("2026-06-01T00:00:00+00:00", [], unmatched=[_listing("u9", "out_of_stock", None, "2026-06-01T00:00:00+00:00")])
    log = history.apply_snapshot(history.empty_log(), snap)
    assert "u9" in log["listings"]


# --- backfill ---------------------------------------------------------------

def test_backfill_equals_sequential_apply():
    snaps = [
        _snap("2026-06-01T00:00:00+00:00", [_listing("u1", "out_of_stock", 1500, "2026-06-01T00:00:00+00:00")]),
        _snap("2026-06-01T01:00:00+00:00", [_listing("u1", "in_stock", 1500, "2026-06-01T01:00:00+00:00")]),
        _snap("2026-06-01T02:00:00+00:00", [_listing("u1", "in_stock", 1800, "2026-06-01T02:00:00+00:00")]),
    ]
    via_backfill = history.backfill(iter(snaps))
    step = history.empty_log()
    for s in snaps:
        step = history.apply_snapshot(step, s)
    assert via_backfill == step
    assert [e["status"] for e in via_backfill["listings"]["u1"]["events"]] == ["out_of_stock", "in_stock", "in_stock"]


def test_backfill_handles_reappearing_listing():
    snaps = [
        _snap("2026-06-01T00:00:00+00:00", [_listing("u1", "in_stock", 1500, "2026-06-01T00:00:00+00:00")]),
        _snap("2026-06-01T01:00:00+00:00", []),  # u1 disappears
        _snap("2026-06-01T02:00:00+00:00", [_listing("u1", "out_of_stock", 1500, "2026-06-01T02:00:00+00:00")]),  # reappears, changed
    ]
    log = history.backfill(snaps)
    assert [e["status"] for e in log["listings"]["u1"]["events"]] == ["in_stock", "out_of_stock"]


# --- prune ------------------------------------------------------------------

def test_prune_drops_old_events_but_keeps_latest():
    log = history.empty_log()
    for t, status in [
        ("2026-01-01T00:00:00+00:00", "in_stock"),
        ("2026-01-02T00:00:00+00:00", "out_of_stock"),
        ("2026-06-01T00:00:00+00:00", "in_stock"),
    ]:
        log = history.apply_snapshot(log, _snap(t, [_listing("u1", status, 1500, t)]))
    pruned = history.prune(log, "2026-06-02T00:00:00+00:00", window_days=30)
    kept = [e["t"] for e in pruned["listings"]["u1"]["events"]]
    assert kept == ["2026-06-01T00:00:00+00:00"]  # only the in-window event survives


def test_prune_and_summarize_handle_mixed_naive_and_aware_timestamps():
    """Early archived snapshots wrote tz-NAIVE seen_at; current ones are tz-aware.
    _parse normalizes naive -> UTC so prune/summarize can compare event times
    against an aware `now` without a 'can't compare offset-naive and offset-aware
    datetimes' TypeError on the mixed archive."""
    log = history.empty_log()
    # Legacy event: tz-naive timestamp (no offset).
    log = history.apply_snapshot(
        log, _snap("2026-01-01T00:00:00", [_listing("u1", "out_of_stock", 1500, "2026-01-01T00:00:00")])
    )
    # Recent event: tz-aware.
    log = history.apply_snapshot(
        log, _snap("2026-06-01T00:00:00+00:00", [_listing("u1", "in_stock", 1500, "2026-06-01T00:00:00+00:00")])
    )

    # prune against an AWARE now must not crash on the naive event, and must drop
    # it (>30d old) while keeping the recent one.
    pruned = history.prune(log, "2026-06-02T00:00:00+00:00", window_days=30)
    assert [e["t"] for e in pruned["listings"]["u1"]["events"]] == ["2026-06-01T00:00:00+00:00"]

    # summarize against an AWARE now must not crash either; the naive OOS event is
    # the prior state, so the in-stock event is a genuine restock.
    summary = history.summarize(log, "2026-06-02T00:00:00+00:00")
    assert summary["u1"]["restock_count"] == 1
    assert summary["u1"]["currently_in_stock"] is True


def test_prune_keeps_single_latest_when_all_old():
    log = history.empty_log()
    for t in ["2026-01-01T00:00:00+00:00", "2026-01-02T00:00:00+00:00"]:
        log = history.apply_snapshot(log, _snap(t, [_listing("u1", "in_stock", 1500, t)]))
    # Only one event total (price/status unchanged), and it's old → still kept.
    pruned = history.prune(log, "2026-06-02T00:00:00+00:00", window_days=30)
    assert len(pruned["listings"]["u1"]["events"]) == 1


# --- summarize --------------------------------------------------------------

def _build(events: list[tuple[str, str, int | None]]) -> dict:
    """events = [(t, status, price)] → a log with one listing 'u1'."""
    log = history.empty_log()
    for t, status, price in events:
        log = history.apply_snapshot(log, _snap(t, [_listing("u1", status, price, t)]))
    return log


def test_summarize_currently_in_stock_and_last_restock():
    log = _build([
        ("2026-06-01T00:00:00+00:00", "out_of_stock", 1500),
        ("2026-06-02T00:00:00+00:00", "in_stock", 1500),       # restock #1
        ("2026-06-03T00:00:00+00:00", "out_of_stock", 1500),
        ("2026-06-04T00:00:00+00:00", "in_stock", 1500),       # restock #2
    ])
    s = history.summarize(log, "2026-06-05T00:00:00+00:00")["u1"]
    assert s["currently_in_stock"] is True
    assert s["last_restock_at"] == "2026-06-04T00:00:00+00:00"
    assert s["restock_count"] == 2
    assert s["last_in_stock_at"] == "2026-06-04T00:00:00+00:00"


def test_summarize_first_seen_in_stock_is_not_a_restock():
    # First appearance is never a restock — we don't know the prior state, and
    # counting it would label every continuously-stocked listing "restocked".
    log = _build([("2026-06-01T00:00:00+00:00", "in_stock", 1500)])
    s = history.summarize(log, "2026-06-02T00:00:00+00:00")["u1"]
    assert s["restock_count"] == 0
    assert s["last_restock_at"] is None
    assert s["currently_in_stock"] is True
    assert s["last_in_stock_at"] == "2026-06-01T00:00:00+00:00"
    assert s["first_seen_at"] == "2026-06-01T00:00:00+00:00"


def test_summarize_genuine_restock_after_out_of_stock():
    log = _build([
        ("2026-06-01T00:00:00+00:00", "in_stock", 1500),       # first seen, not a restock
        ("2026-06-02T00:00:00+00:00", "out_of_stock", 1500),
        ("2026-06-03T00:00:00+00:00", "in_stock", 1500),       # genuine restock
    ])
    s = history.summarize(log, "2026-06-04T00:00:00+00:00")["u1"]
    assert s["restock_count"] == 1
    assert s["last_restock_at"] == "2026-06-03T00:00:00+00:00"


def test_summarize_first_seen_out_of_stock_is_not_restock():
    log = _build([("2026-06-01T00:00:00+00:00", "out_of_stock", 1500)])
    s = history.summarize(log, "2026-06-02T00:00:00+00:00")["u1"]
    assert s["restock_count"] == 0
    assert s["last_restock_at"] is None
    assert s["last_in_stock_at"] is None


def test_summarize_price_prev_is_last_differing_known_price():
    log = _build([
        ("2026-06-01T00:00:00+00:00", "in_stock", 1500),
        ("2026-06-02T00:00:00+00:00", "in_stock", None),   # price unknown
        ("2026-06-03T00:00:00+00:00", "in_stock", 1800),   # current
    ])
    s = history.summarize(log, "2026-06-04T00:00:00+00:00")["u1"]
    assert s["price_current_cents"] == 1800
    assert s["price_prev_cents"] == 1500  # skips the null


def test_summarize_price_prev_none_when_price_never_changed():
    log = _build([
        ("2026-06-01T00:00:00+00:00", "out_of_stock", 1500),
        ("2026-06-02T00:00:00+00:00", "in_stock", 1500),
    ])
    s = history.summarize(log, "2026-06-03T00:00:00+00:00")["u1"]
    assert s["price_prev_cents"] is None


def test_summarize_price_low_high_over_window_ignores_nulls():
    log = _build([
        ("2026-01-01T00:00:00+00:00", "in_stock", 900),    # outside 30d window
        ("2026-06-01T00:00:00+00:00", "in_stock", 1500),
        ("2026-06-02T00:00:00+00:00", "in_stock", None),
        ("2026-06-03T00:00:00+00:00", "in_stock", 1200),   # current
    ])
    s = history.summarize(log, "2026-06-04T00:00:00+00:00", price_window_days=30)["u1"]
    # 900 is outside the window; nulls ignored; current 1200 always included.
    assert s["price_low_cents"] == 1200
    assert s["price_high_cents"] == 1500
