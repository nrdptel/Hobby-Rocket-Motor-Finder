from hpr_finder.normalize import base_designation, extract_designation


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


def test_base_strips_delay():
    assert base_designation("H242T-14A") == "H242T"
    assert base_designation("H283ST") == "H283ST"
    assert base_designation("G75J-10A") == "G75J"
    assert base_designation("I366R-14A") == "I366R"


def test_base_does_not_strip_internal_hyphens():
    # If a designation has no trailing -<digits>, base passes through.
    assert base_designation("HP-H115DM") == "HP-H115DM"


def test_lp_base_handles_low_power_format():
    from hpr_finder.normalize import lp_base_designation
    # Low-power format: D13-10W -> D13W
    assert lp_base_designation("D13-10W") == "D13W"
    assert lp_base_designation("D24-7T") == "D24T"
    assert lp_base_designation("E18-4W") == "E18W"


def test_chain_yields_at_least_one_matchable_candidate():
    # For HPR motors, base_designation produces the catalog form.
    # For LP motors, lp_base_designation produces the catalog form.
    # Either transform may over-match on the wrong format, but db.find_motor_id
    # tries all three (raw, base, lp_base) so at least one wins.
    from hpr_finder.normalize import lp_base_designation
    assert base_designation("H242T-14A") == "H242T"
    assert lp_base_designation("D13-10W") == "D13W"
