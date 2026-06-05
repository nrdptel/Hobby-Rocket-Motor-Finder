"""Parse-level tests for the Balsa Machining Service scraper.

Balsa lists its whole high-power (AeroTech-only) catalog on one page, one
``<TR VALIGN=TOP>`` per item, with each motor linking to its ThrustCurve page.
Fixture: a slice of the live page (2026-06) with in-stock motors (numeric
quantity), out-of-stock motors, two "Manufacturer discontinued" motors, and two
hardware rows (no ThrustCurve link) that must be skipped.
"""
from pathlib import Path

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.balsa_machining import HPM_URL, _classify_stock, parse_motors

FIXTURES = Path(__file__).parent / "fixtures"


def _listings():
    return parse_motors((FIXTURES / "balsa_machining_hpm.html").read_text(encoding="utf-8"))


def _by_sku(listings, sku):
    return next(l for l in listings if l.sku == sku)


def test_parses_only_motor_rows_skips_hardware():
    listings = _listings()
    # 9 motor rows; the two hardware/accessory rows (no ThrustCurve link) dropped.
    assert len(listings) == 9
    assert all(l.manufacturer == "AeroTech" for l in listings)
    assert all(l.vendor_slug == "balsa_machining" for l in listings)
    assert all(l.motor_designation and l.sku for l in listings)
    # Stable per-product URL keyed on the catalog #.
    assert len({l.url for l in listings}) == len(listings)


def test_in_stock_motor_has_numeric_count():
    l = _by_sku(_listings(), "077214")
    assert l.motor_designation == "G72DM-14A"
    assert l.status == StockStatus.IN_STOCK_WITH_COUNT
    assert l.stock_count == 6
    assert l.price_cents == 3509  # sale price actually charged
    assert l.url == f"{HPM_URL}#077214"


def test_out_of_stock_motor():
    l = _by_sku(_listings(), "070800")
    assert l.motor_designation == "G8ST-P"
    assert l.status == StockStatus.OUT_OF_STOCK
    assert l.stock_count is None
    assert l.price_cents == 3869  # list price still shown when out of stock


def test_zero_available_is_out_of_stock():
    # "0 available" means sold out, not in-stock-with-count-zero.
    assert _classify_stock('<span style="color:green">0  available</span>') == (
        StockStatus.OUT_OF_STOCK,
        None,
    )
    assert _classify_stock('<span style="color:green">5  available</span>') == (
        StockStatus.IN_STOCK_WITH_COUNT,
        5,
    )


def test_designation_pulled_from_link_text():
    # "AT M1340W" style designations come straight from the row's link text.
    skus = {l.sku: l.motor_designation for l in _listings()}
    assert skus["061112"] == "F115SN-12A"
    assert skus["13134P"] == "M1340W"  # a "Manufacturer discontinued" motor still listed
    assert skus["081114"] == "H115DM-14A"


def test_manufacturer_taken_from_thrustcurve_link():
    # Every motor's manufacturer is read from its thrustcurve.org/motors/<MFR>/ URL.
    assert all(l.manufacturer == "AeroTech" for l in _listings())
