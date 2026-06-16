"""Parse-level tests for the Balsa Machining Service scraper.

Balsa lists its whole high-power (AeroTech-only) catalog on one page, one
``<TR VALIGN=TOP>`` per item, with each motor linking to its ThrustCurve page.
Fixture: a slice of the live page (2026-06) with in-stock motors (numeric
quantity), out-of-stock motors, two "Manufacturer discontinued" motors, and two
hardware rows (no ThrustCurve link) that must be skipped.
"""
from pathlib import Path

import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.balsa_machining import (
    HPM_URL,
    BalsaMachiningScraper,
    _classify_stock,
    _last_price_cents,
    parse_motors,
)

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


# --- parse / classify guard branches -----------------------------------------


def test_parse_motors_skips_row_missing_catalog_cell():
    # A ThrustCurve-linked row with no catalog SKU cell is skipped.
    html = '<TR VALIGN=TOP><a href="https://www.thrustcurve.org/motors/AeroTech/H100W-14A">x</a></TR>'
    assert parse_motors(html) == []


def test_parse_motors_skips_row_without_a_valid_designation():
    html = (
        "<TR VALIGN=TOP><TD><FONT>1ABC23</FONT></TD>"
        "https://www.thrustcurve.org/motors/AeroTech/foo "
        'click for thrust curve"> Just Hardware <span></TR>'
    )
    assert parse_motors(html) == []


def test_classify_stock_unknown_without_availability_or_oos():
    assert _classify_stock("<td>no availability info here</td>") == (StockStatus.UNKNOWN, None)


def test_last_price_cents_none_without_a_price():
    assert _last_price_cents("<td>no dollar amount</td>") is None


# --- scrape() ----------------------------------------------------------------


class _FakeResp:
    def __init__(self, content: bytes):
        self.content = content

    def raise_for_status(self):
        return None


class _FakeClient:
    def __init__(self, content: bytes):
        self._content = content

    async def get(self, url, **kwargs):
        return _FakeResp(self._content)


def _hpm_bytes() -> bytes:
    return (FIXTURES / "balsa_machining_hpm.html").read_bytes()


@pytest.mark.asyncio
async def test_scrape_parses_the_hpm_page():
    listings = await BalsaMachiningScraper().scrape(_FakeClient(_hpm_bytes()))
    assert len(listings) > 0
    assert all(l.vendor_slug == "balsa_machining" for l in listings)


@pytest.mark.asyncio
async def test_scrape_respects_limit():
    listings = await BalsaMachiningScraper().scrape(_FakeClient(_hpm_bytes()), limit=1)
    assert len(listings) == 1


@pytest.mark.asyncio
async def test_scrape_only_urls_filters_to_requested():
    everything = await BalsaMachiningScraper().scrape(_FakeClient(_hpm_bytes()))
    target = everything[0].url
    filtered = await BalsaMachiningScraper().scrape(_FakeClient(_hpm_bytes()), only_urls=[target])
    assert filtered and all(l.url == target for l in filtered)
