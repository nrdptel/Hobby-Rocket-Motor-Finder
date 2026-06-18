"""Tests for the Cesaroni (CTI) normalizer — ``extract_cti_designation`` and
``infer_cti_propellant``.

CTI's grammar differs fundamentally from AeroTech: the designation carries no
propellant letter (the commonName is just class + avg thrust, e.g. ``I445``) and
the propellant is a separate *flavor* word in the title. See docs/CTI_spike.md.
"""
from __future__ import annotations

import pytest

from hpr_finder.normalize import extract_cti_designation, infer_cti_propellant, parse_amw_cti

# --- extract_cti_designation: the two real vendor title formats ------------

@pytest.mark.parametrize(
    "title,expected",
    [
        # csrocketry: "Cesaroni <commonName>-<delay>A <flavor> Rocket Motor"
        ("Cesaroni I170-14A Classic Rocket Motor", "I170"),
        ("Cesaroni I55-9A Mellow Rocket Motor", "I55"),
        ("Cesaroni I345-15A White Thunder Rocket Motor", "I345"),
        # Wildman: "<commonName>-CTI <flavor>"  (literal -CTI tag, no delay)
        ("N5600-CTI White Thunder", "N5600"),
        ("M1675-CTI  Pink", "M1675"),  # double space tolerated
        ("O3400-CTI IMAX", "O3400"),
        # catalog leading-total-impulse form: "234I445" -> "I445"
        ("234I445-16A", "I445"),
        # lowercase tolerated, result uppercased
        ("cesaroni k261 white long burn", "K261"),
    ],
)
def test_extract_cti_designation_formats(title, expected):
    assert extract_cti_designation(title) == expected


def test_extract_cti_designation_none_on_empty_or_no_motor():
    assert extract_cti_designation("") is None
    assert extract_cti_designation(None) is None  # type: ignore[arg-type]


def test_extract_cti_designation_ignores_pro_hardware():
    """Pro<size> casings/closures must NOT be read as a motor — the leading
    'Pro' has no word boundary before the digits, and 'P54' isn't class+digits."""
    assert extract_cti_designation("Pro54 Casing") is None
    assert extract_cti_designation("Pro38 6G Forward Closure") is None
    assert extract_cti_designation("P98-RR") is None


# --- infer_cti_propellant: flavor alias table ------------------------------

@pytest.mark.parametrize(
    "title,expected",
    [
        # Full ThrustCurve spellings
        ("Cesaroni I345 White Thunder", "White Thunder"),
        ("Cesaroni I236 Blue Streak", "Blue Streak"),
        ("Cesaroni I195 Red Lightning", "Red Lightning"),
        # Wildman abbreviations
        ("N2540-CTI Green", "Green3"),
        ("N4100-CTI Red", "Red Lightning"),
        ("N2850-CTI Blue", "Blue Streak"),
        ("N3400-CTI Skid Mark", "Skidmark"),
        ("N5800-CTI C Star", "C-Star"),
        # csrocketry slug spelling
        ("Cesaroni I212 Smokey Sam", "Smoky Sam"),
        # Performance Hobbies underscore-separated flavor
        ("1750-K650-16A - Smoky_Sam", "Smoky Sam"),
        # bare White must NOT be read as White Thunder
        ("Cesaroni I175 White", "White"),
        ("N1560-CTI White Moon Burner", "White"),
    ],
)
def test_infer_cti_propellant_aliases(title, expected):
    assert infer_cti_propellant(title) == expected


def test_infer_cti_propellant_longest_match_first():
    """'White Thunder' must win over bare 'White' regardless of position."""
    assert infer_cti_propellant("White Thunder reload") == "White Thunder"
    assert infer_cti_propellant("the White Thunder") == "White Thunder"


def test_extract_cti_designation_five_digit_thrust():
    # High-thrust O/N motors have 5-digit avg-thrust commonNames; must not be missed.
    assert extract_cti_designation("Cesaroni N10000 White") == "N10000"
    assert extract_cti_designation("12345 O25000-something") == "O25000"


def test_infer_cti_propellant_none_when_absent():
    assert infer_cti_propellant("Cesaroni N1100 Moon Burner") is None
    assert infer_cti_propellant("") is None


# --- parse_amw_cti: AMW's code-glued CTI format ----------------------------


@pytest.mark.parametrize(
    "raw,common,propinfo",
    [
        # the code is glued straight onto the commonName, then casing + "Reload"
        ("F51BS 24-2G Reload", "F51", "Blue Streak"),
        ("K530SS 54-4G Reload", "K530", "Smoky Sam"),
        ("K515SK 54-5G Reload", "K515", "Skidmark"),
        ("K261WH 54-5G Reload", "K261", "White"),
        ("I540WT 38-5G Reload", "I540", "White Thunder"),
        ("G127RL 24-6GG Reload", "G127", "Red Lightning"),
        ("H53MY P29-5G Reload", "H53", "Mellow"),  # AMW's non-standard MY = Mellow
        # the desc sometimes leads with a casing label; the first CTI token wins
        ("F36SS P29-1G Reload", "F36", "Smoky Sam"),
        # 150mm research motors: comma in the thrust, 5 digits, no "Reload" word
        ("O25,000VM", "O25000", "Vmax"),
        ("O5800WT", "O5800", "White Thunder"),
    ],
)
def test_parse_amw_cti(raw, common, propinfo):
    assert parse_amw_cti(raw) == (common, propinfo)


@pytest.mark.parametrize(
    "raw",
    [
        # hardware in the same categories carries no class designation. The
        # lowercase "o" in "Pro.." must NOT be read as an O-class motor.
        "Pro54-1 Casing",
        "Pro54 Rear Closure",
        "Pro98-Nozzle Holder",
        "P54 Nozzle spacer",
        "Pro24 DAT centering ring",
        "Product Short description",
        "",
    ],
)
def test_parse_amw_cti_rejects_hardware(raw):
    assert parse_amw_cti(raw) is None


def test_parse_amw_cti_unknown_code_keeps_commonname():
    # An unrecognized code -> commonName only, propInfo None (matcher then falls
    # back to a commonName-only match rather than guessing a flavor).
    assert parse_amw_cti("K530ZZ 54-4G Reload") == ("K530", None)
