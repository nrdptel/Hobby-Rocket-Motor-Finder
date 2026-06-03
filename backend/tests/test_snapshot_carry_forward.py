"""Tests for snapshot.carry_forward — keep a degraded vendor's last-good data."""
from __future__ import annotations

from hpr_finder.snapshot import carry_forward, vendor_counts


def _listing(vendor, url, status="in_stock"):
    return {
        "vendor_slug": vendor, "vendor_name": vendor.title(), "url": url,
        "sku": None, "price_cents": 1000, "currency": "USD", "status": status,
        "stock_count": None, "seen_at": "2026-06-01T00:00:00+00:00",
        "raw_designation": "X",
    }


def _motor(mfr, des, listings, impulse_class="H"):
    return {
        "id": abs(hash((mfr, des))) % 100000, "manufacturer": mfr, "designation": des,
        "common_name": des, "diameter_mm": 29, "impulse_class": impulse_class,
        "total_impulse_ns": 1.0, "avg_thrust_n": 1.0, "burn_time_s": 1.0,
        "propellant": None, "delays": None, "delay_adjustable": False,
        "listings": listings,
    }


def _snap(motors, unmatched=None, generated_at="2026-06-02T00:00:00+00:00"):
    return {"generated_at": generated_at, "motors": motors, "unmatched": unmatched or []}


# --- vendor_counts ---------------------------------------------------------

def test_vendor_counts():
    snap = _snap([
        _motor("AeroTech", "H1", [_listing("csrocketry", "a"), _listing("amw", "b")]),
        _motor("AeroTech", "H2", [_listing("csrocketry", "c")]),
    ])
    assert vendor_counts(snap) == {"csrocketry": 2, "amw": 1}


# --- healthy: fresh kept, prev ignored -------------------------------------

def test_all_healthy_uses_fresh_only():
    fresh = _snap([_motor("AeroTech", "H1", [_listing("csrocketry", "fresh-url")])])
    prev = _snap([_motor("AeroTech", "H1", [_listing("csrocketry", "old-url")])])
    merged, report = carry_forward(fresh, prev, floor=1)
    assert report["decision"]["csrocketry"] == "healthy"
    urls = [l["url"] for m in merged["motors"] for l in m["listings"]]
    assert urls == ["fresh-url"]  # prev not used
    assert report["failed"] == []


# --- carried: degraded vendor reuses prev ----------------------------------

def test_degraded_vendor_carries_prev_forward():
    # amw scrapes 0 this run but had data last run; csrocketry healthy.
    fresh = _snap([_motor("AeroTech", "H1", [_listing("csrocketry", "cs-fresh")])])
    prev = _snap([
        _motor("AeroTech", "H1", [_listing("csrocketry", "cs-old")]),
        _motor("AeroTech", "K9", [_listing("amw", "amw-old-1"), _listing("amw", "amw-old-2")]),
    ])
    merged, report = carry_forward(fresh, prev, floor=2)
    assert report["decision"]["csrocketry"] == "carried"  # only 1 < floor 2
    assert report["decision"]["amw"] == "carried"
    # The amw motor (absent from fresh) is restored from prev.
    by_des = {m["designation"]: m for m in merged["motors"]}
    assert "K9" in by_des
    amw_urls = {l["url"] for l in by_des["K9"]["listings"]}
    assert amw_urls == {"amw-old-1", "amw-old-2"}
    assert report["failed"] == []


def test_degraded_vendor_with_healthy_one_on_same_motor():
    # Motor H1 sold by both csrocketry (healthy) and amw (degraded, carried).
    fresh = _snap([_motor("AeroTech", "H1", [
        _listing("csrocketry", "cs1"), _listing("csrocketry", "cs2"),
    ])])
    prev = _snap([_motor("AeroTech", "H1", [
        _listing("csrocketry", "cs-old"), _listing("amw", "amw-old"),
    ])])
    merged, _ = carry_forward(fresh, prev, floor=2)
    h1 = next(m for m in merged["motors"] if m["designation"] == "H1")
    vendors = {l["vendor_slug"] for l in h1["listings"]}
    urls = {l["url"] for l in h1["listings"]}
    assert vendors == {"csrocketry", "amw"}     # fresh cs + carried amw
    assert urls == {"cs1", "cs2", "amw-old"}    # cs fresh (not cs-old), amw prev


# --- failed: degraded with no prior data -----------------------------------

def test_degraded_vendor_with_no_prev_is_failed():
    fresh = _snap([_motor("AeroTech", "H1", [_listing("csrocketry", "cs1")])])
    merged, report = carry_forward(fresh, prev=None, floor=5)
    assert report["decision"]["csrocketry"] == "failed"
    assert report["failed"] == ["csrocketry"]
    # We still produce a payload; the caller decides to refuse publishing.
    assert merged["motors"][0]["listings"][0]["url"] == "cs1"


def test_missing_prev_treated_as_empty():
    fresh = _snap([_motor("AeroTech", "H1", [_listing("csrocketry", "cs1")])])
    _, report = carry_forward(fresh, prev=None, floor=1)
    assert report["decision"]["csrocketry"] == "healthy"
    assert report["failed"] == []


# --- unmatched follows the same rule ---------------------------------------

def test_unmatched_carried_for_degraded_vendor():
    fresh = _snap(
        [_motor("AeroTech", "H1", [_listing("csrocketry", "cs1")])],
        unmatched=[{"vendor_slug": "csrocketry", "url": "u-fresh", "raw_designation": "Z",
                    "raw_title": "Z", "vendor_name": "C", "sku": None, "price_cents": None,
                    "currency": "USD", "status": "unknown", "stock_count": None,
                    "seen_at": "2026-06-02T00:00:00+00:00"}],
    )
    prev = _snap(
        [_motor("AeroTech", "K9", [_listing("amw", "a1"), _listing("amw", "a2")])],
        unmatched=[{"vendor_slug": "amw", "url": "u-amw-old", "raw_designation": "Q",
                    "raw_title": "Q", "vendor_name": "A", "sku": None, "price_cents": None,
                    "currency": "USD", "status": "unknown", "stock_count": None,
                    "seen_at": "2026-06-01T00:00:00+00:00"}],
    )
    merged, report = carry_forward(fresh, prev, floor=2)
    um_urls = {u["url"] for u in merged["unmatched"]}
    assert um_urls == {"u-fresh", "u-amw-old"}  # csrocketry fresh + amw carried


# --- generated_at reflects the fresh run -----------------------------------

def test_generated_at_is_from_fresh():
    fresh = _snap([_motor("AeroTech", "H1", [_listing("csrocketry", "x")])],
                  generated_at="2026-06-03T12:00:00+00:00")
    merged, _ = carry_forward(fresh, prev=None, floor=1)
    assert merged["generated_at"] == "2026-06-03T12:00:00+00:00"
