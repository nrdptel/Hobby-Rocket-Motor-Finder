"""Tests for the Cesaroni branch of ``db.find_motor_id``.

CTI matches on (commonName, flavor[, diameter]) rather than the AeroTech
transform chain. The catalog stores the manufacturer as "Cesaroni Technology"
(ThrustCurve's record name; the search query is "Cesaroni").
"""
from __future__ import annotations

import sqlite3

import pytest

from hpr_finder.db import find_motor_id, init_schema, upsert_motors
from hpr_finder.models import Motor

MFR = "Cesaroni Technology"


def _cti(designation, common_name, propellant, diameter_mm=38, impulse_class="I"):
    return Motor(
        manufacturer=MFR,
        designation=designation,
        common_name=common_name,
        diameter_mm=diameter_mm,
        length_mm=None,
        total_impulse_ns=None,
        avg_thrust_n=None,
        burn_time_s=None,
        propellant=propellant,
        impulse_class=impulse_class,
        delays=None,
        delay_adjustable=True,
        thrustcurve_id=None,
    )


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    init_schema(c)
    yield c
    c.close()


# --- commonName + flavor match ---------------------------------------------

def test_cti_matches_on_common_name_and_flavor(conn):
    upsert_motors(conn, [_cti("234I445-16A", "I445", "White Thunder")])
    mid = find_motor_id(conn, MFR, "I445", "Cesaroni I445-16A White Thunder Rocket Motor")
    assert mid is not None


def test_cti_flavor_disambiguates_same_common_name(conn):
    """Same commonName, two flavors -> the title's flavor picks the right one."""
    upsert_motors(conn, [
        _cti("176H123-12A", "H123", "Skidmark", diameter_mm=29, impulse_class="H"),
        _cti("220H160-14A", "H160", "Skidmark", diameter_mm=29, impulse_class="H"),
        _cti("999I445-16A", "I445", "Blue Streak"),
        _cti("234I445-16A", "I445", "White Thunder"),
    ])
    wt = find_motor_id(conn, MFR, "I445", "I445 White Thunder")
    bs = find_motor_id(conn, MFR, "I445", "I445 Blue Streak")
    assert wt is not None and bs is not None and wt != bs


# --- diameter disambiguation (the lone H123 Skidmark collision) ------------

def test_cti_diameter_breaks_common_name_flavor_collision(conn):
    upsert_motors(conn, [
        _cti("176H123-12A", "H123", "Skidmark", diameter_mm=29, impulse_class="H"),
        _cti("232H123-14A", "H123", "Skidmark", diameter_mm=38, impulse_class="H"),
    ])
    m29 = find_motor_id(conn, MFR, "H123", "H123 Skidmark", diameter_mm=29)
    m38 = find_motor_id(conn, MFR, "H123", "H123 Skidmark", diameter_mm=38)
    assert m29 is not None and m38 is not None and m29 != m38


def test_cti_collision_without_diameter_is_deterministic(conn):
    """No diameter hint on a collision -> stable pick (doesn't error or flap)."""
    upsert_motors(conn, [
        _cti("176H123-12A", "H123", "Skidmark", diameter_mm=29, impulse_class="H"),
        _cti("232H123-14A", "H123", "Skidmark", diameter_mm=38, impulse_class="H"),
    ])
    a = find_motor_id(conn, MFR, "H123", "H123 Skidmark")
    b = find_motor_id(conn, MFR, "H123", "H123 Skidmark")
    assert a is not None and a == b


# --- commonName-only fallback ----------------------------------------------

def test_cti_falls_back_to_unique_common_name_without_flavor(conn):
    """Title has no recognizable flavor (e.g. 'Moon Burner') but the commonName
    is unique -> still matches."""
    upsert_motors(conn, [_cti("4754N1100-P", "N1100", "Classic", diameter_mm=75, impulse_class="N")])
    mid = find_motor_id(conn, MFR, "N1100", "N1100-CTI Moon Burner")
    assert mid is not None


def test_cti_ambiguous_common_name_without_flavor_returns_none(conn):
    """Two motors share a commonName and the title gives no flavor -> no guess."""
    upsert_motors(conn, [
        _cti("999I445-16A", "I445", "Blue Streak"),
        _cti("234I445-16A", "I445", "White Thunder"),
    ])
    assert find_motor_id(conn, MFR, "I445", "Cesaroni I445 reload") is None


# --- isolation from AeroTech -----------------------------------------------

def test_cti_does_not_match_aerotech_rows(conn):
    """A Cesaroni query must not resolve to an AeroTech motor of the same class."""
    upsert_motors(conn, [
        Motor(manufacturer="AeroTech", designation="I445", common_name="I445",
              diameter_mm=38, length_mm=None, total_impulse_ns=None, avg_thrust_n=None,
              burn_time_s=None, propellant="Blue Thunder", impulse_class="I",
              delays=None, delay_adjustable=False, thrustcurve_id=None),
    ])
    assert find_motor_id(conn, MFR, "I445", "Cesaroni I445 White Thunder") is None


def test_aerotech_query_unaffected_by_cti_dispatch(conn):
    """Regression: the manufacturer dispatch must not disturb AeroTech matching."""
    upsert_motors(conn, [
        Motor(manufacturer="AeroTech", designation="H242T-14A", common_name="H242",
              diameter_mm=29, length_mm=None, total_impulse_ns=None, avg_thrust_n=None,
              burn_time_s=None, propellant="Blue Thunder", impulse_class="H",
              delays=None, delay_adjustable=False, thrustcurve_id=None),
    ])
    assert find_motor_id(conn, "AeroTech", "H242T-14A") is not None
