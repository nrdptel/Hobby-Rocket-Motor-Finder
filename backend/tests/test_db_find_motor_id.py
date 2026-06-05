"""Tests for ``db.find_motor_id`` — the listing → catalog matching engine.

Every transform step in the 9-stage fallback chain plus the
common_name + propellant disambiguation tier gets a dedicated case. Each
test seeds an in-memory SQLite DB with the minimal motor rows needed to
exercise one step.
"""
from __future__ import annotations

import sqlite3

import pytest

from hpr_finder.db import find_motor_id, init_schema, upsert_motors
from hpr_finder.models import Motor


def _make_motor(
    designation: str,
    common_name: str = "",
    propellant: str | None = None,
    impulse_class: str = "H",
    diameter_mm: int = 29,
    availability: str | None = None,
) -> Motor:
    """Build a minimal Motor record for tests. Only fields find_motor_id
    actually queries are set meaningfully; the rest get reasonable defaults
    so the upsert succeeds."""
    return Motor(
        manufacturer="AeroTech",
        designation=designation,
        common_name=common_name or designation,
        diameter_mm=diameter_mm,
        length_mm=None,
        total_impulse_ns=None,
        avg_thrust_n=None,
        burn_time_s=None,
        propellant=propellant,
        impulse_class=impulse_class,
        delays=None,
        delay_adjustable=False,
        thrustcurve_id=None,
        availability=availability,
    )


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    init_schema(c)
    yield c
    c.close()


def _seed(conn: sqlite3.Connection, *motors: Motor) -> None:
    upsert_motors(conn, list(motors))


# --- step 1: exact designation match ----------------------------------------

def test_exact_match(conn):
    _seed(conn, _make_motor("H242T-14A"))
    assert find_motor_id(conn, "AeroTech", "H242T-14A") is not None


def test_no_match_returns_none(conn):
    _seed(conn, _make_motor("H242T-14A"))
    assert find_motor_id(conn, "AeroTech", "Z9999X-99") is None


def test_empty_designation_returns_none(conn):
    _seed(conn, _make_motor("H242T-14A"))
    assert find_motor_id(conn, "AeroTech", "") is None


def test_case_insensitive_designation(conn):
    _seed(conn, _make_motor("H242T-14A"))
    # Vendor sometimes writes lowercase ("h242t-14a") — match should still hit.
    assert find_motor_id(conn, "AeroTech", "h242t-14a") is not None


def test_case_insensitive_manufacturer(conn):
    _seed(conn, _make_motor("H242T-14A"))
    assert find_motor_id(conn, "aerotech", "H242T-14A") is not None


# --- step 2: HPR delay-suffix strip -----------------------------------------

def test_hpr_delay_suffix_strip(conn):
    # Vendor "H242T-14A", catalog has bare "H242T". Step 2 strips "-14A".
    _seed(conn, _make_motor("H242T"))
    assert find_motor_id(conn, "AeroTech", "H242T-14A") is not None


# --- step 3: low/mid-power delay-infix strip --------------------------------

def test_lp_delay_infix_strip_keeps_propellant_letter(conn):
    # Vendor "D13-10W", catalog "D13W". Step 3 strips "-10" keeping "W".
    _seed(conn, _make_motor("D13W", impulse_class="D"))
    assert find_motor_id(conn, "AeroTech", "D13-10W") is not None


def test_lp_delay_with_multi_letter_propellant(conn):
    # Black Max (FJ) — vendor "F23-4FJ", catalog "F23FJ".
    _seed(conn, _make_motor("F23FJ", impulse_class="F"))
    assert find_motor_id(conn, "AeroTech", "F23-4FJ") is not None


# --- step 4: plug-suffix strip ----------------------------------------------

def test_plug_suffix_strip_p(conn):
    # Vendor "M1297W-P", catalog "M1297W".
    _seed(conn, _make_motor("M1297W", impulse_class="M"))
    assert find_motor_id(conn, "AeroTech", "M1297W-P") is not None


def test_plug_then_delay_strip(conn):
    # Vendor "H242T-P-14A" (plug before delay). Step 5 = strip_plug_suffix(base):
    # base strips -14A → "H242T-P", then plug strips -P → "H242T". Catalog match.
    _seed(conn, _make_motor("H242T"))
    assert find_motor_id(conn, "AeroTech", "H242T-P-14A") is not None


# --- step 6: double-plug strip (stacked suffixes) ---------------------------

def test_double_plug_strip(conn):
    # Vendor "H13ST-P-NTR" — strip -NTR, then strip -P, then match catalog.
    _seed(conn, _make_motor("H13ST"))
    assert find_motor_id(conn, "AeroTech", "H13ST-P-NTR") is not None


# --- step 7: internal-hyphen strip ------------------------------------------

def test_internal_hyphen_strip(conn):
    # Vendor "H550-ST-14A": base strips -14A → "H550-ST"; hyphen strip → "H550ST".
    _seed(conn, _make_motor("H550ST"))
    assert find_motor_id(conn, "AeroTech", "H550-ST-14A") is not None


# --- step 9: no-hyphen-delay strip (Sirius "J340-M14A" case) ----------------

def test_no_hyphen_delay_strip_sirius_form(conn):
    # Sirius writes "J340-M14A". Internal-hyphen strip → "J340M14A".
    # No-hyphen-delay strip → "J340M".
    _seed(conn, _make_motor("J340M", impulse_class="J"))
    assert find_motor_id(conn, "AeroTech", "J340-M14A") is not None


# --- common_name + propellant disambiguation tier ---------------------------

def test_common_name_with_propellant_disambiguates(conn):
    # Vendor "M1500" (bare), title "Mojave Green Rocket Motor". Catalog has
    # M1500G with propellant="Mojave Green" and M1500W with propellant=
    # "White Lightning". Should pick M1500G.
    _seed(
        conn,
        _make_motor("M1500G", common_name="M1500", propellant="Mojave Green", impulse_class="M"),
        _make_motor("M1500W", common_name="M1500", propellant="White Lightning", impulse_class="M"),
    )
    m_id = find_motor_id(conn, "AeroTech", "M1500", title="AeroTech M1500 Mojave Green Rocket Motor")
    assert m_id is not None
    row = conn.execute("SELECT designation FROM motors WHERE id = ?", (m_id,)).fetchone()
    assert row["designation"] == "M1500G"


def test_common_name_unique_match_no_propellant_needed(conn):
    # Vendor "H115DM", catalog has only HP-H115DM with common_name "H115".
    # The bare-designation common_name path strips trailing "DM" → "H115",
    # and since only one catalog row shares that common_name, it matches
    # even without a propellant in the title.
    _seed(conn, _make_motor("HP-H115DM", common_name="H115", impulse_class="H"))
    assert find_motor_id(conn, "AeroTech", "H115DM") is not None


def test_common_name_ambiguous_without_propellant_returns_none(conn):
    # Two catalog rows share common_name "M1500" and no propellant is
    # inferrable from the title — last-resort path requires a unique row,
    # so this should NOT match anything.
    _seed(
        conn,
        _make_motor("M1500G", common_name="M1500", propellant="Mojave Green", impulse_class="M"),
        _make_motor("M1500W", common_name="M1500", propellant="White Lightning", impulse_class="M"),
    )
    assert find_motor_id(conn, "AeroTech", "M1500", title="Aerotech M1500 Rocket Motor") is None


# --- manufacturer scoping ---------------------------------------------------

def test_manufacturer_scope_excludes_other_brands(conn):
    _seed(conn, _make_motor("H242T-14A"))
    # Same designation but different manufacturer — no match.
    assert find_motor_id(conn, "Cesaroni", "H242T-14A") is None


# --- out-of-production (OOP) motors & two-pass current-first matching --------

def test_oop_only_motor_matches_old_stock(conn):
    """A vendor selling old stock of a discontinued motor matches the OOP catalog
    entry when no current motor fits (e.g. AeroTech E15W)."""
    _seed(conn, _make_motor("E15W", common_name="E15", availability="OOP"))
    assert find_motor_id(conn, "AeroTech", "E15-PW", "E15-PW 3PK") is not None


def test_current_preferred_over_oop_on_exact_designation(conn):
    """Regression guard: the vendor's stripped designation 'H45W' exactly equals
    an OOP motor's designation, but a current motor (HP-H45W, common_name H45)
    is what the listing really is. The current-first pass must win."""
    current = _make_motor("HP-H45W", common_name="H45", propellant="White Lightning")
    oop = _make_motor("H45W", common_name="H45", propellant="White Lightning", availability="OOP")
    _seed(conn, current, oop)
    mid = find_motor_id(conn, "AeroTech", "H45W-P", "Aerotech H45-P White Lightning 38mm DMS")
    got = conn.execute("SELECT designation FROM motors WHERE id=?", (mid,)).fetchone()[0]
    assert got == "HP-H45W"  # current DMS motor, not the discontinued RMS H45W


def test_current_preferred_when_oop_shares_common_name(conn):
    """A propellant-less listing whose common_name is shared by a current motor and
    a discontinued variant still matches the current one (current-only pass finds
    a unique current motor before the OOP pass runs)."""
    current = _make_motor("F32T", common_name="F32", propellant="Blue Thunder")
    oop = _make_motor("F32W", common_name="F32", propellant="White Lightning", availability="OOP")
    _seed(conn, current, oop)
    # No propellant in the title → relies on the common_name uniqueness step.
    mid = find_motor_id(conn, "AeroTech", "F32", "AeroTech F32")
    got = conn.execute("SELECT designation FROM motors WHERE id=?", (mid,)).fetchone()[0]
    assert got == "F32T"


def test_adding_oop_does_not_break_existing_unique_common_name(conn):
    """Sanity: a current motor uniquely identified by common_name still matches
    after an OOP variant with the same common_name is added to the catalog."""
    _seed(
        conn,
        _make_motor("J350W", common_name="J350", propellant="White Lightning"),
        _make_motor("J350W-OLD", common_name="J350", propellant="White Lightning", availability="OOP"),
    )
    mid = find_motor_id(conn, "AeroTech", "J350", "AeroTech J350 White Lightning")
    got = conn.execute("SELECT designation FROM motors WHERE id=?", (mid,)).fetchone()[0]
    assert got == "J350W"
