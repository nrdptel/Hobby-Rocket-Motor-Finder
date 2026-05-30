from hpr_finder.normalize import (
    base_designation,
    common_name,
    extract_designation,
    infer_propellant_from_title,
    lp_base_designation,
)


# --- extract_designation ----------------------------------------------------

def test_extract_basic_hpr():
    assert extract_designation("Aerotech H242T-14A Blue Thunder Rocket Motor") == "H242T-14A"


def test_extract_lowercase_aerotech_prefix():
    assert extract_designation("aerotech H73J-10A Black Jack Rocket Motor") == "H73J-10A"


def test_extract_no_delay_suffix():
    assert extract_designation("AeroTech H283ST 38MM DMS") == "H283ST"


def test_extract_short_class():
    assert extract_designation("Aerotech G75J-10A Black Jack") == "G75J-10A"


def test_extract_no_match_returns_none():
    assert extract_designation("AeroTech Mantis Launch Pad") is None


def test_extract_empty():
    assert extract_designation("") is None
    assert extract_designation(None) is None  # type: ignore[arg-type]


def test_extract_multi_letter_propellant_in_suffix():
    # Black Max (FJ) and Dark Matter (DM) use 2-letter propellant codes that
    # the old regex clipped to 1 letter because of the \b boundary.
    assert extract_designation("Aerotech F23-4FJ (2-Pack) Black Max Rocket Motor") == "F23-4FJ"
    assert extract_designation("Aerotech H178DM-14A Dark Matter Rocket Motor") == "H178DM-14A"
    assert extract_designation("Aerotech F51-10NT (2-Pack) Blue Thunder Rocket Motor") == "F51-10NT"


def test_extract_bare_designation_no_propellant():
    # Large HPR motors are often listed with only common-name designation;
    # propellant lives in the title text only.
    assert extract_designation("Aerotech M1500 Mojave Green Rocket Motor") == "M1500"
    assert extract_designation("Aerotech N1000 White Lightning Rocket Motor") == "N1000"


# --- base_designation -------------------------------------------------------

def test_base_strips_delay():
    assert base_designation("H242T-14A") == "H242T"
    assert base_designation("H283ST") == "H283ST"
    assert base_designation("G75J-10A") == "G75J"
    assert base_designation("I366R-14A") == "I366R"


def test_base_handles_multi_letter_suffix():
    assert base_designation("F23-4FJ") == "F23"
    assert base_designation("F51-10NT") == "F51"


def test_base_does_not_strip_internal_hyphens():
    assert base_designation("HP-H115DM") == "HP-H115DM"


# --- lp_base_designation ----------------------------------------------------

def test_lp_base_handles_low_power_format():
    assert lp_base_designation("D13-10W") == "D13W"
    assert lp_base_designation("D24-7T") == "D24T"
    assert lp_base_designation("E18-4W") == "E18W"


def test_lp_base_handles_two_letter_propellant():
    assert lp_base_designation("F23-4FJ") == "F23FJ"
    assert lp_base_designation("F51-10NT") == "F51NT"


# --- common_name ------------------------------------------------------------

def test_common_name_strips_trailing_propellant():
    assert common_name("H242T") == "H242"
    assert common_name("M1500G") == "M1500"
    assert common_name("F23FJ") == "F23"
    assert common_name("L1170FJ") == "L1170"


def test_common_name_handles_delay_suffix_first():
    assert common_name("H242T-14A") == "H242"


def test_common_name_passes_through_no_letters():
    assert common_name("M1500") == "M1500"


# --- infer_propellant_from_title --------------------------------------------

def test_infer_propellant_basic():
    assert infer_propellant_from_title("Aerotech M1500 Mojave Green Rocket Motor") == "Mojave Green"
    assert infer_propellant_from_title("Aerotech H238T-14A Blue Thunder") == "Blue Thunder"
    assert infer_propellant_from_title("Aerotech H165R-14A Redline Rocket Motor") == "Redline"


def test_infer_propellant_longer_phrase_wins():
    # "Super White Lightning" should beat "White Lightning"
    assert infer_propellant_from_title("Aerotech L1256 Super White Lightning") == "Super White Lightning"
    assert infer_propellant_from_title("Aerotech M4500 Super Thunder Rocket Motor") == "Super Thunder"


def test_infer_propellant_normalizes_naming():
    # "Black Jack" and "Blackjack" both map to ThrustCurve's "Blackjack"
    assert infer_propellant_from_title("Aerotech H73J-10A Black Jack") == "Blackjack"
    # "Metal Storm" and "Metalstorm" both map to "Metalstorm"
    assert infer_propellant_from_title("Aerotech M1305 Metal Storm") == "Metalstorm"


def test_infer_propellant_no_match():
    assert infer_propellant_from_title("Aerotech Mantis Launch Pad") is None
    assert infer_propellant_from_title("") is None
    assert infer_propellant_from_title(None) is None  # type: ignore[arg-type]
