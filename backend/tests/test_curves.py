"""Tests for thrust-curve selection + sidecar shaping.

The download fetch isn't exercised against the live network (same policy as the
catalog fetch); these cover the pure logic that turns raw simfiles into the
compact, one-curve-per-motor sidecar.
"""
from __future__ import annotations

from hpr_finder.curves import build_curves, curve_key, select_curve


def _sf(source: str, samples: list[tuple[float, float]]) -> dict:
    return {"source": source, "samples": [{"time": t, "thrust": f} for t, f in samples]}


def test_select_curve_prefers_cert_over_mfr_over_user():
    user = _sf("user", [(0, 0), (1, 50), (2, 0)])
    mfr = _sf("mfr", [(0, 0), (1, 60), (2, 0)])
    cert = _sf("cert", [(0, 0), (1, 70), (2, 0)])
    # cert wins regardless of order
    assert select_curve([user, mfr, cert]) == [[0, 0], [1, 70], [2, 0]]
    assert select_curve([cert, user, mfr]) == [[0, 0], [1, 70], [2, 0]]


def test_select_curve_breaks_source_ties_by_point_count():
    sparse = _sf("user", [(0, 0), (1, 50)])
    rich = _sf("user", [(0, 0), (0.5, 40), (1, 50), (1.5, 20), (2, 0)])
    assert select_curve([sparse, rich]) == rich_pts()


def rich_pts():
    return [[0, 0], [0.5, 40], [1, 50], [1.5, 20], [2, 0]]


def test_select_curve_cleans_and_sorts_and_rounds():
    messy = _sf(
        "cert",
        [(1.0, 50.005), (0.0, 0.0), (0.5, 40.0), (2.0, -3.0), (None, 5.0)],  # type: ignore[list-item]
    )
    # negative thrust + non-numeric time rows dropped; sorted by time; rounded.
    assert select_curve([messy]) == [[0, 0], [0.5, 40.0], [1.0, 50.01]]


def test_select_curve_none_when_no_usable_series():
    assert select_curve([]) is None
    assert select_curve([_sf("cert", [(0, 0)])]) is None  # single point → unusable
    assert select_curve([_sf("user", [])]) is None


def test_curve_key_joins_manufacturer_and_designation():
    assert curve_key("AeroTech", "J90W") == "AeroTech|J90W"


def test_build_curves_keys_by_motor_and_drops_curveless_motors():
    id_to_motor = {
        "id1": ("AeroTech", "J90W"),
        "id2": ("Cesaroni Technology", "K530"),
        "id3": ("Loki Research", "M1969"),  # no raw data → absent
    }
    raw = {
        "id1": [_sf("user", [(0, 0), (1, 90), (2, 0)])],
        "id2": [_sf("cert", [(0, 0), (1.5, 530), (3, 0)])],
    }
    curves = build_curves(id_to_motor, raw)
    assert curves["AeroTech|J90W"] == [[0, 0], [1, 90], [2, 0]]
    assert curves["Cesaroni Technology|K530"] == [[0, 0], [1.5, 530], [3, 0]]
    assert "Loki Research|M1969" not in curves
