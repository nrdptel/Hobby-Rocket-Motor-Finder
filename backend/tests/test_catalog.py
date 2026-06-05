"""Tests for the ThrustCurve catalog parser.

The fetch path is intentionally not exercised against a live network — we
have no control over the upstream service and don't want test runs hitting
it. The fixture covers what we DO control: how the raw API records map
into ``Motor`` dataclasses, including the missing-field cases that
silently produced bad data in the past.
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from hpr_finder.catalog import (
    _maybe_float,
    _maybe_int,
    aerotech_motors,
    all_motors,
    cesaroni_motors,
    load_cache,
    refresh_catalog,
    save_cache,
    to_motor,
)

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def sample_records() -> list[dict]:
    return json.loads((FIXTURES / "thrustcurve_search_sample.json").read_text())


# --- to_motor: normal record -----------------------------------------------

def test_to_motor_normal_hpr(sample_records):
    m = to_motor(sample_records[0])
    assert m.manufacturer == "AeroTech"
    assert m.designation == "H242T-14A"
    assert m.common_name == "H242"
    assert m.diameter_mm == 29
    assert m.length_mm == 124
    assert m.total_impulse_ns == pytest.approx(237.0)
    assert m.avg_thrust_n == pytest.approx(242.0)
    assert m.burn_time_s == pytest.approx(0.98)
    assert m.propellant == "Blue Thunder"
    assert m.impulse_class == "H"
    assert m.delays == "6,10,14"
    assert m.delay_adjustable is True
    assert m.thrustcurve_id == "abc123"


# --- to_motor: missing commonName falls back to designation ----------------

def test_to_motor_falls_back_to_designation_when_common_name_missing(sample_records):
    m = to_motor(sample_records[1])
    # No "commonName" in the M1500 record — common_name should equal designation.
    assert m.common_name == m.designation == "M1500"


# --- to_motor: sparse record (many optional fields missing) ----------------

def test_to_motor_handles_sparse_record(sample_records):
    m = to_motor(sample_records[2])
    assert m.designation == "D2.3T"
    assert m.diameter_mm == 18
    assert m.impulse_class == "D"
    # All these were absent from the record:
    assert m.length_mm is None
    assert m.total_impulse_ns is None
    assert m.avg_thrust_n is None
    assert m.burn_time_s is None
    assert m.propellant is None
    assert m.delays is None
    assert m.delay_adjustable is False


# --- to_motor: regression on integer/float coercion ------------------------

def test_to_motor_coerces_string_numeric_fields():
    # ThrustCurve sometimes returns numerics as strings. Should still produce
    # a valid Motor without raising.
    m = to_motor({
        "manufacturer": "AeroTech",
        "designation": "Test1",
        "diameter": "29",          # str
        "length": "124",            # str
        "totImpulseNs": "237.5",    # str
        "avgThrustN": "242.0",      # str
        "burnTimeS": "0.98",        # str
        "impulseClass": "H",
        "delayAdjustable": 0,       # falsy int
    })
    assert m.diameter_mm == 29
    assert m.length_mm == 124
    assert m.total_impulse_ns == pytest.approx(237.5)
    assert m.avg_thrust_n == pytest.approx(242.0)
    assert m.burn_time_s == pytest.approx(0.98)
    assert m.delay_adjustable is False


def test_to_motor_handles_bad_numerics_as_none():
    m = to_motor({
        "manufacturer": "AeroTech",
        "designation": "Test2",
        "diameter": "not-a-number",   # _maybe_int returns None
        "length": "junk",             # _maybe_int returns None
        "impulseClass": "H",
    })
    # diameter_mm is int (not Optional) — falls to 0 via `int(... or 0)`.
    assert m.diameter_mm == 0
    assert m.length_mm is None


# --- _maybe_int / _maybe_float helpers -------------------------------------

def test_maybe_int_passthrough_and_coercion():
    assert _maybe_int(42) == 42
    assert _maybe_int("42") == 42
    assert _maybe_int(None) is None
    assert _maybe_int("not-a-number") is None


def test_maybe_float_passthrough_and_coercion():
    assert _maybe_float(1.5) == pytest.approx(1.5)
    assert _maybe_float("1.5") == pytest.approx(1.5)
    assert _maybe_float(None) is None
    assert _maybe_float("junk") is None


# --- cache round-trip -------------------------------------------------------

def test_cache_round_trip(tmp_path, sample_records):
    path = tmp_path / "catalog.json"
    save_cache(sample_records, path)
    loaded = load_cache(path)
    assert loaded == sample_records


def test_save_cache_creates_parent_dir(tmp_path, sample_records):
    nested = tmp_path / "deep" / "down" / "catalog.json"
    save_cache(sample_records, nested)
    assert nested.exists()


# --- aerotech_motors: cache-first path -------------------------------------

def test_aerotech_motors_reads_cache_when_present(monkeypatch, tmp_path, sample_records):
    """When the cache file exists, ``aerotech_motors`` must read from it
    without making any network calls. This is a non-negotiable regression
    test: tests must never hit the live ThrustCurve API."""
    cache_path = tmp_path / "thrustcurve_aerotech.json"
    cache_path.write_text(json.dumps(sample_records))

    import hpr_finder.catalog as catalog
    monkeypatch.setattr(catalog, "CACHE_PATH", cache_path)

    # If the cache miss path were taken, this would error — fetch is
    # not patched, so a network call would fail or contact upstream.
    def _explode(*args, **kwargs):
        raise AssertionError("fetch should not be called when cache exists")
    monkeypatch.setattr(catalog, "fetch_aerotech_motors", _explode)

    motors = aerotech_motors(use_cache=True)
    assert len(motors) == 3
    assert motors[0].designation == "H242T-14A"


def test_aerotech_motors_can_skip_cache(monkeypatch, tmp_path, sample_records):
    """When ``use_cache=False`` the fetch path is taken even if the cache
    is present. The result is then saved back to the cache."""
    cache_path = tmp_path / "thrustcurve_aerotech.json"
    cache_path.write_text(json.dumps([{"manufacturer": "AeroTech", "designation": "STALE"}]))

    import hpr_finder.catalog as catalog
    monkeypatch.setattr(catalog, "CACHE_PATH", cache_path)
    monkeypatch.setattr(catalog, "fetch_aerotech_motors", lambda: sample_records)

    motors = aerotech_motors(use_cache=False)
    # We got the fresh records, not the stale one.
    assert "STALE" not in {m.designation for m in motors}
    assert motors[0].designation == "H242T-14A"
    # And the cache was updated.
    written = json.loads(cache_path.read_text())
    assert written == sample_records


# --- cesaroni_motors: parallel cache-first path ----------------------------

def test_cesaroni_motors_reads_cache_when_present(monkeypatch, tmp_path, sample_records):
    """Cesaroni mirrors AeroTech: when its cache exists, no network call.
    Uses the generic ``fetch_motors`` rather than a manufacturer-specific fetch."""
    cache_path = tmp_path / "thrustcurve_cesaroni.json"
    cache_path.write_text(json.dumps(sample_records))

    import hpr_finder.catalog as catalog
    monkeypatch.setattr(catalog, "CESARONI_CACHE_PATH", cache_path)

    def _explode(*args, **kwargs):
        raise AssertionError("fetch_motors should not be called when cache exists")
    monkeypatch.setattr(catalog, "fetch_motors", _explode)

    motors = cesaroni_motors(use_cache=True)
    assert len(motors) == 3


def test_cesaroni_motors_fetches_with_manufacturer_when_no_cache(monkeypatch, tmp_path, sample_records):
    """On cache miss, ``cesaroni_motors`` fetches the Cesaroni manufacturer and
    writes the cache back."""
    cache_path = tmp_path / "thrustcurve_cesaroni.json"  # does not exist yet

    import hpr_finder.catalog as catalog
    monkeypatch.setattr(catalog, "CESARONI_CACHE_PATH", cache_path)

    called_with = {}
    def _fake_fetch(manufacturer, timeout=30.0):
        called_with["manufacturer"] = manufacturer
        return sample_records
    monkeypatch.setattr(catalog, "fetch_motors", _fake_fetch)

    motors = cesaroni_motors(use_cache=False)
    assert called_with["manufacturer"] == "Cesaroni"
    assert len(motors) == 3
    assert json.loads(cache_path.read_text()) == sample_records


# --- all_motors: concatenation of every manufacturer -----------------------

def test_all_motors_concatenates_manufacturers(monkeypatch, tmp_path, sample_records):
    """``all_motors`` returns AeroTech + Cesaroni from their respective caches."""
    at_cache = tmp_path / "thrustcurve_aerotech.json"
    cti_cache = tmp_path / "thrustcurve_cesaroni.json"
    at_cache.write_text(json.dumps(sample_records))
    cti_cache.write_text(json.dumps(sample_records[:2]))

    import hpr_finder.catalog as catalog
    monkeypatch.setattr(catalog, "CACHE_PATH", at_cache)
    monkeypatch.setattr(catalog, "CESARONI_CACHE_PATH", cti_cache)

    motors = all_motors(use_cache=True)
    assert len(motors) == 3 + 2


# --- refresh_catalog: live fetch with cache fallback -----------------------

def test_refresh_catalog_live_success_writes_cache(monkeypatch, tmp_path, sample_records):
    """A successful live fetch returns fresh motors, marks not-stale, and
    refreshes the on-disk cache."""
    cache_path = tmp_path / "thrustcurve_aerotech.json"

    import hpr_finder.catalog as catalog
    monkeypatch.setattr(catalog, "fetch_motors", lambda m, timeout=30.0: sample_records)

    motors, stale = refresh_catalog("AeroTech", cache_path)
    assert stale is False
    assert len(motors) == 3
    # Cache was written for next time / as the fallback source.
    assert json.loads(cache_path.read_text()) == sample_records


def test_refresh_catalog_falls_back_to_cache_on_fetch_failure(monkeypatch, tmp_path, sample_records):
    """When ThrustCurve errors but a committed cache exists, fall back to it and
    report stale=True instead of failing the whole run with an empty catalog."""
    cache_path = tmp_path / "thrustcurve_aerotech.json"
    cache_path.write_text(json.dumps(sample_records))

    import hpr_finder.catalog as catalog

    def _boom(manufacturer, timeout=30.0):
        raise httpx.ConnectError("thrustcurve down")
    monkeypatch.setattr(catalog, "fetch_motors", _boom)

    motors, stale = refresh_catalog("AeroTech", cache_path)
    assert stale is True
    assert len(motors) == 3
    assert motors[0].designation == "H242T-14A"


def test_refresh_catalog_reraises_when_no_cache_to_fall_back_to(monkeypatch, tmp_path):
    """First-run-with-no-cache: a fetch failure has nothing to offer, so it must
    propagate rather than silently producing an empty catalog."""
    cache_path = tmp_path / "missing.json"  # does not exist

    import hpr_finder.catalog as catalog

    def _boom(manufacturer, timeout=30.0):
        raise httpx.HTTPStatusError("503", request=None, response=None)
    monkeypatch.setattr(catalog, "fetch_motors", _boom)

    with pytest.raises(httpx.HTTPError):
        refresh_catalog("AeroTech", cache_path)


# --- manufacturer registry: refresh_all iterates MANUFACTURERS -------------

def test_refresh_all_iterates_manufacturer_registry(monkeypatch, tmp_path, sample_records):
    """refresh_all() fetches every manufacturer in the registry (in order),
    writes each cache, and returns one (name, motors, stale) per manufacturer —
    so adding a manufacturer is a single MANUFACTURERS entry."""
    import hpr_finder.catalog as catalog
    monkeypatch.setattr(catalog, "CACHE_PATH", tmp_path / "at.json")
    monkeypatch.setattr(catalog, "CESARONI_CACHE_PATH", tmp_path / "cti.json")

    calls = []
    def fake_fetch(name, timeout=30.0):
        calls.append(name)
        return sample_records if name == "AeroTech" else sample_records[:2]
    monkeypatch.setattr(catalog, "fetch_motors", fake_fetch)

    results = catalog.refresh_all()

    assert [name for name, _, _ in results] == ["AeroTech", "Cesaroni"]
    assert calls == ["AeroTech", "Cesaroni"]  # one fetch per registry entry, in order
    assert len(results[0][1]) == 3 and results[0][2] is False
    assert len(results[1][1]) == 2 and results[1][2] is False
    assert (tmp_path / "at.json").exists() and (tmp_path / "cti.json").exists()
