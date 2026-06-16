"""Tests for the restock diff that drives email alerts."""
from __future__ import annotations

from hpr_finder.alerts import newly_available_motors, restocked_motors


def _motor(
    mfr,
    des,
    listings,
    common_name=None,
    diameter_mm=None,
    impulse_class=None,
    total_impulse_ns=None,
    case_info=None,
    motor_type=None,
):
    return {
        "manufacturer": mfr,
        "designation": des,
        "common_name": common_name or des,
        "diameter_mm": diameter_mm,
        "impulse_class": impulse_class,
        "total_impulse_ns": total_impulse_ns,
        "case_info": case_info,
        "motor_type": motor_type,
        "listings": listings,
    }


def _listing(url, status):
    return {"vendor_slug": "v", "url": url, "status": status}


def _snap(motors):
    return {"motors": motors}


def test_out_to_in_is_a_restock():
    prev = _snap([_motor("AeroTech", "J500G", [_listing("u1", "out_of_stock")])])
    cur = _snap([
        _motor("AeroTech", "J500G", [_listing("u1", "in_stock")],
               diameter_mm=54, impulse_class="J", total_impulse_ns=1000.0,
               case_info="RMS-54/852", motor_type="reload"),
    ])
    out = restocked_motors(prev, cur)
    # The fit-relevant specs ride along so the dispatch route can match rockets —
    # including case_info + motor_type so it can match by reload case.
    assert out == [{
        "manufacturer": "AeroTech",
        "designation": "J500G",
        "common_name": "J500G",
        "diameter_mm": 54,
        "impulse_class": "J",
        "total_impulse_ns": 1000.0,
        "case_info": "RMS-54/852",
        "motor_type": "reload",
    }]


def test_in_stock_with_count_counts_as_in_stock():
    prev = _snap([_motor("AeroTech", "H100W", [_listing("u1", "out_of_stock")])])
    cur = _snap([_motor("AeroTech", "H100W", [_listing("u1", "in_stock_with_count")])])
    assert len(restocked_motors(prev, cur)) == 1


def test_still_in_stock_is_not_a_restock():
    prev = _snap([_motor("AeroTech", "J", [_listing("u1", "in_stock")])])
    cur = _snap([_motor("AeroTech", "J", [_listing("u1", "in_stock")])])
    assert restocked_motors(prev, cur) == []


def test_brand_new_listing_in_stock_is_not_a_restock():
    # A URL absent from prev (new product / new vendor / first run) must NOT
    # flood alerts — only genuine comebacks of a previously-tracked listing.
    prev = _snap([])
    cur = _snap([_motor("AeroTech", "K", [_listing("new-url", "in_stock")])])
    assert restocked_motors(prev, cur) == []


def test_special_order_to_in_stock_is_a_restock():
    prev = _snap([_motor("Cesaroni Technology", "I445", [_listing("u1", "special_order")])])
    cur = _snap([_motor("Cesaroni Technology", "I445", [_listing("u1", "in_stock")])])
    assert restocked_motors(prev, cur)[0]["designation"] == "I445"


def test_motor_with_multiple_vendors_dedups_and_any_restock_counts():
    prev = _snap([
        _motor("AeroTech", "M1300", [_listing("a", "out_of_stock"), _listing("b", "in_stock")]),
    ])
    cur = _snap([
        # vendor a restocked; vendor b still in stock — one restock event, deduped.
        _motor("AeroTech", "M1300", [_listing("a", "in_stock"), _listing("b", "in_stock")]),
    ])
    out = restocked_motors(prev, cur)
    assert len(out) == 1 and out[0]["designation"] == "M1300"


def test_carry_forward_identical_status_does_not_trigger():
    # Carried-forward vendors republish identical statuses → no transition.
    prev = _snap([_motor("AeroTech", "G80", [_listing("u1", "out_of_stock")])])
    cur = _snap([_motor("AeroTech", "G80", [_listing("u1", "out_of_stock")])])
    assert restocked_motors(prev, cur) == []


def test_missing_or_empty_snapshots_are_safe():
    assert restocked_motors({}, {}) == []
    assert restocked_motors({"motors": []}, {"motors": []}) == []


# --- newly_available_motors: a "phantom" appearing in stock for the first time ---


def test_phantom_first_appearance_is_newly_available():
    # K1100 was in NO previous snapshot (nobody stocked it); now a vendor lists it.
    prev = _snap([_motor("AeroTech", "J500G", [_listing("u1", "in_stock")])])
    cur = _snap([
        _motor("AeroTech", "J500G", [_listing("u1", "in_stock")]),
        _motor("Cesaroni Technology", "K1100", [_listing("new", "in_stock")],
               diameter_mm=54, impulse_class="K", total_impulse_ns=2500.0,
               case_info="Pro54-5G", motor_type="reload"),
    ])
    out = newly_available_motors(prev, cur)
    assert out == [{
        "manufacturer": "Cesaroni Technology",
        "designation": "K1100",
        "common_name": "K1100",
        "diameter_mm": 54,
        "impulse_class": "K",
        "total_impulse_ns": 2500.0,
        "case_info": "Pro54-5G",
        "motor_type": "reload",
        "first_available": True,
    }]


def test_restock_is_not_newly_available():
    # An out→in comeback of a known motor is a RESTOCK, not a first appearance.
    prev = _snap([_motor("AeroTech", "J500G", [_listing("u1", "out_of_stock")])])
    cur = _snap([_motor("AeroTech", "J500G", [_listing("u1", "in_stock")])])
    assert newly_available_motors(prev, cur) == []  # it's in prev → not "new"
    assert len(restocked_motors(prev, cur)) == 1  # caught by the other diff


def test_already_listed_motor_is_not_newly_available():
    prev = _snap([_motor("AeroTech", "J500G", [_listing("u1", "in_stock")])])
    cur = _snap([_motor("AeroTech", "J500G", [_listing("u1", "in_stock")])])
    assert newly_available_motors(prev, cur) == []


def test_new_motor_but_out_of_stock_is_not_newly_available():
    prev = _snap([_motor("AeroTech", "J500G", [_listing("u1", "in_stock")])])
    cur = _snap([
        _motor("AeroTech", "J500G", [_listing("u1", "in_stock")]),
        _motor("AeroTech", "X9", [_listing("n", "out_of_stock")]),  # appeared, but OOS
    ])
    assert newly_available_motors(prev, cur) == []


def test_empty_prev_never_floods():
    cur = _snap([_motor("AeroTech", "J500G", [_listing("u1", "in_stock")])])
    assert newly_available_motors({}, cur) == []
    assert newly_available_motors({"motors": []}, cur) == []
