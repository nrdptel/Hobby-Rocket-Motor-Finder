"""Tests for thrust-curve selection + sidecar shaping.

The download fetch isn't exercised against the live network (same policy as the
catalog fetch); these cover the pure logic that turns raw simfiles into the
compact, one-curve-per-motor sidecar, plus the request batching/grouping in
``fetch_curves`` with a stubbed HTTP client.
"""
from __future__ import annotations

import httpx
import pytest

from hpr_finder import curves
from hpr_finder.curves import build_curves, curve_key, fetch_curves, select_curve


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
    curves_out = build_curves(id_to_motor, raw)
    assert curves_out["AeroTech|J90W"] == [[0, 0], [1, 90], [2, 0]]
    assert curves_out["Cesaroni Technology|K530"] == [[0, 0], [1.5, 530], [3, 0]]
    assert "Loki Research|M1969" not in curves_out


# --- fetch_curves: request batching + result grouping (stubbed HTTP) ----------


class _FakeResp:
    def __init__(self, results: list[dict], ok: bool = True):
        self._results, self._ok = results, ok

    def raise_for_status(self) -> None:
        if not self._ok:
            raise httpx.HTTPError("download failed")

    def json(self) -> dict:
        return {"results": self._results}


class _FakeClient:
    """Stands in for httpx.Client: records each POST's motorIds and replays a
    response from ``responder(chunk)``."""

    def __init__(self, calls: list[list[str]], responder, **_kwargs):
        self._calls = calls
        self._responder = responder

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def post(self, _url, json):
        chunk = list(json["motorIds"])
        self._calls.append(chunk)
        assert json["data"] == "samples"
        return self._responder(chunk)


def _patch_client(monkeypatch, calls, responder):
    monkeypatch.setattr(curves.httpx, "Client", lambda **kw: _FakeClient(calls, responder, **kw))


def test_fetch_curves_batches_ids_and_groups_by_motor(monkeypatch):
    calls: list[list[str]] = []
    _patch_client(monkeypatch, calls, lambda chunk: _FakeResp([{"motorId": m, "n": m} for m in chunk]))

    ids = [f"id{i}" for i in range(90)]
    by_id = fetch_curves(ids, batch_size=40)

    # 90 ids → batches of 40, 40, 10.
    assert [len(c) for c in calls] == [40, 40, 10]
    assert len(by_id) == 90
    assert by_id["id0"] == [{"motorId": "id0", "n": "id0"}]


def test_fetch_curves_groups_multiple_simfiles_and_skips_idless_rows(monkeypatch):
    rows = [
        {"motorId": "a", "source": "cert"},
        {"motorId": "a", "source": "user"},  # same motor, second simfile
        {"source": "mfr"},  # no motorId → dropped
    ]
    _patch_client(monkeypatch, [], lambda _chunk: _FakeResp(rows))

    by_id = fetch_curves(["a"], batch_size=40)
    assert list(by_id) == ["a"]
    assert len(by_id["a"]) == 2


def test_fetch_curves_makes_no_request_for_empty_ids(monkeypatch):
    calls: list[list[str]] = []
    _patch_client(monkeypatch, calls, lambda _chunk: _FakeResp([]))
    assert fetch_curves([]) == {}
    assert calls == []


def test_fetch_curves_raises_on_http_error(monkeypatch):
    _patch_client(monkeypatch, [], lambda _chunk: _FakeResp([], ok=False))
    with pytest.raises(httpx.HTTPError):
        fetch_curves(["a"])


def test_id_to_motor_maps_ids_and_skips_incomplete_records(monkeypatch):
    monkeypatch.setattr(curves, "MANUFACTURERS", ["AeroTech"])
    monkeypatch.setattr(curves, "_cache_path", lambda mc: mc)
    monkeypatch.setattr(
        curves,
        "load_cache",
        lambda _p: [
            {"motorId": "1", "manufacturer": "AeroTech", "designation": "J90W"},
            {"motorId": "2", "manufacturer": "AeroTech"},  # no designation → skipped
            {"manufacturer": "AeroTech", "designation": "X"},  # no motorId → skipped
        ],
    )
    assert curves._id_to_motor() == {"1": ("AeroTech", "J90W")}


def test_refresh_curves_writes_sorted_compact_sidecar(monkeypatch, tmp_path):
    monkeypatch.setattr(
        curves, "_id_to_motor", lambda: {"id1": ("AeroTech", "J90W"), "id2": ("Loki", "M1969")}
    )
    # id2 has no raw curve → dropped from the sidecar.
    monkeypatch.setattr(
        curves, "fetch_curves", lambda _ids: {"id1": [_sf("cert", [(0, 0), (1, 90), (2, 0)])]}
    )
    out = tmp_path / "sub" / "curves.json"  # parent dir doesn't exist yet
    n = curves.refresh_curves(out)

    assert n == 1
    text = out.read_text()
    assert text.endswith("\n")
    # Compact separators (no spaces) + sorted keys, the format the frontend reads.
    assert ", " not in text and '": ' not in text
    import json

    assert json.loads(text) == {"AeroTech|J90W": [[0, 0], [1, 90], [2, 0]]}
