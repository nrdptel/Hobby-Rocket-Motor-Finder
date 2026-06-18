"""Parse-level tests for the AMW scraper using a captured category-page fixture.

AMW is unusual in that *all* the info we care about (designation, stock count,
price, status) lives in the category listing — no per-product fetch needed.
This fixture is one of the larger DMS category pages so the parser is
exercised across many statuses.
"""
import re
from pathlib import Path

import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.amw import PRICE_RE, AMWScraper, _parse_status
from hpr_finder.scrapers.prices import price_to_cents

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text()


def test_parses_multiple_listings_from_fixture():
    s = AMWScraper()
    html = _load("amw_cat104_dms.html")
    listings = s._parse_category(html)
    # The DMS category had 43 distinct products at capture time; if the parser
    # regresses we'll catch it as a dramatic drop.
    assert len(listings) >= 30, f"only parsed {len(listings)} listings"


def test_listings_have_required_fields():
    s = AMWScraper()
    html = _load("amw_cat104_dms.html")
    listings = s._parse_category(html)
    for l in listings:
        assert l.vendor_slug == "amw"
        assert l.motor_designation
        assert l.sku  # AMW pid — used for dedup across overlapping categories
        assert l.url.startswith("https://cart.amwprox.com/")
        assert l.currency == "USD"


def test_specific_in_stock_listing():
    s = AMWScraper()
    html = _load("amw_cat104_dms.html")
    listings = s._parse_category(html)
    by_des = {l.motor_designation: l for l in listings}
    # G125T-14A is reliably present and in stock at capture time
    g125 = by_des.get("G125T-14A")
    assert g125 is not None
    assert g125.status is StockStatus.IN_STOCK_WITH_COUNT
    assert g125.stock_count is not None and g125.stock_count > 0
    assert g125.price_cents == 3314  # $33.14


def test_special_order_listing():
    s = AMWScraper()
    html = _load("amw_cat104_dms.html")
    listings = s._parse_category(html)
    by_des = {l.motor_designation: l for l in listings}
    # G72DM-14A was a "Call" → special order at capture time
    g72 = by_des.get("G72DM-14A")
    assert g72 is not None
    assert g72.status is StockStatus.SPECIAL_ORDER
    assert g72.stock_count is None


# --- helper unit tests ------------------------------------------------------

def test_parse_status_in_stock_with_count():
    status, count = _parse_status('<span class="amw_in_stock">5 In Stock</span>')
    assert status is StockStatus.IN_STOCK_WITH_COUNT
    assert count == 5


def test_parse_status_call():
    status, count = _parse_status('<span class="amw_status">Call</span>')
    assert status is StockStatus.SPECIAL_ORDER
    assert count is None


def test_parse_status_preorder():
    status, count = _parse_status('<span class="amw_status">Pre-Order</span>')
    assert status is StockStatus.SPECIAL_ORDER
    assert count is None


def test_parse_status_missing():
    status, count = _parse_status("<div>no status here</div>")
    assert status is StockStatus.UNKNOWN
    assert count is None


def test_parse_status_zero_in_stock_is_out_of_stock():
    # "0 In Stock" means sold out — must NOT report in-stock-with-count-zero.
    status, count = _parse_status('<span class="amw_in_stock">0 In Stock</span>')
    assert status is StockStatus.OUT_OF_STOCK
    assert count is None


# --- PRICE_RE: thousands separators on big N/O-class motors -----------------


def test_price_re_matches_plain_price():
    m = PRICE_RE.search('PricesalesPrice" >$33.14</span>')
    assert m and price_to_cents(m.group(1)) == 3314


def test_price_re_matches_comma_thousands_price():
    # N/O-class DMS reloads run over $1,000; without comma support the price
    # was missed and the listing recorded None despite a visible price.
    m = PRICE_RE.search('PricesalesPrice" >$1,383.00</span>')
    assert m and price_to_cents(m.group(1)) == 138300


def test_price_to_cents_normal():
    assert price_to_cents("33.14") == 3314
    assert price_to_cents("600.09") == 60009


def test_price_to_cents_none():
    assert price_to_cents(None) is None


def test_price_to_cents_bogus():
    assert price_to_cents("not-a-price") is None


# --- _parse_status branches --------------------------------------------------


def test_parse_status_call_is_special_order():
    status, count = _parse_status("Call <br>for price")
    assert status is StockStatus.SPECIAL_ORDER and count is None


def test_parse_status_preorder_is_special_order():
    assert _parse_status("Pre-Order now")[0] is StockStatus.SPECIAL_ORDER


def test_parse_status_no_match_is_unknown():
    assert _parse_status("no stock info here")[0] is StockStatus.UNKNOWN


# --- _parse_category guard branches ------------------------------------------


def test_parse_category_skips_block_without_numeric_pid():
    # Block carries the product marker but a non-numeric id -> no match -> skipped.
    html = '<div class="product floatleft">productdetails&virtuemart_product_id=abc</div>'
    assert AMWScraper()._parse_category(html) == []


def test_parse_category_dedupes_repeated_pid_within_a_page():
    block = (
        '<div class="product floatleft">'
        "productdetails&virtuemart_product_id=999 "
        '<a title="AeroTech H100W">x</a></div>'
    )
    # Same product id twice on one page -> parsed at most once (no crash).
    once = AMWScraper()._parse_category(block)
    twice = AMWScraper()._parse_category(block + block)
    assert len(twice) == len(once)


# --- scrape() orchestration --------------------------------------------------


class _FakeResp:
    def __init__(self, text: str):
        self.text = text

    def raise_for_status(self):
        return None


class _FakeClient:
    def __init__(self, body: str):
        self._body = body

    async def get(self, url, **kwargs):
        return _FakeResp(self._body)


@pytest.mark.asyncio
async def test_scrape_dedupes_products_across_categories():
    listings = await AMWScraper().scrape(_FakeClient(_load("amw_cat104_dms.html")))
    assert len(listings) > 0
    skus = [l.sku for l in listings if l.sku]
    assert len(skus) == len(set(skus))  # deduped by product id across categories


@pytest.mark.asyncio
async def test_scrape_respects_limit():
    listings = await AMWScraper().scrape(_FakeClient(_load("amw_cat104_dms.html")), limit=2)
    assert len(listings) == 2


@pytest.mark.asyncio
async def test_scrape_url_lookup_is_unsupported():
    assert await AMWScraper().scrape(_FakeClient(""), only_urls=["https://amw/x"]) == []


@pytest.mark.asyncio
async def test_scrape_isolates_a_failing_category():
    class _FailClient:
        async def get(self, url, **kwargs):
            raise RuntimeError("category page down")

    assert await AMWScraper().scrape(_FailClient()) == []


# --- Cesaroni (CTI) categories ----------------------------------------------

CESARONI = "Cesaroni Technology"


def _cti_listings():
    # The 54mm CTI category fixture: 5 reloads + 11 hardware rows (casings,
    # closures, spacers, a centering ring, a placeholder).
    return AMWScraper()._parse_category(_load("amw_cti_cat6_54mm.html"), CESARONI, 54)


def test_cti_parses_only_the_reloads():
    listings = _cti_listings()
    # Exactly the five in-stock reloads on the page — hardware is excluded.
    assert {l.motor_designation for l in listings} == {"K530", "K515", "K650", "K261", "K675"}


def test_cti_listings_are_tagged_for_the_cesaroni_match_path():
    for l in _cti_listings():
        assert l.manufacturer == CESARONI  # routes find_motor_id to the CTI path
        assert l.diameter_mm == 54  # the category's diameter, for disambiguation
        assert l.vendor_slug == "amw" and l.sku and l.currency == "USD"
        # designation is the bare commonName (class + thrust, no propellant code)
        assert re.fullmatch(r"[D-O]\d{2,5}", l.motor_designation)


def test_cti_title_is_rematch_ready():
    # The rebuilt title must let the shared CTI helpers resolve commonName + flavor
    # (they run again on every rematch), and it keeps the vendor's raw in parens.
    from hpr_finder.normalize import extract_cti_designation, infer_cti_propellant

    by_des = {l.motor_designation: l for l in _cti_listings()}
    k530 = by_des["K530"]
    assert extract_cti_designation(k530.raw_title) == "K530"
    assert infer_cti_propellant(k530.raw_title) == "Smoky Sam"
    assert "K530SS 54-4G Reload" in k530.raw_title  # vendor raw preserved


def test_cti_excludes_hardware():
    raws = " ".join(l.raw_title for l in _cti_listings())
    for hw in ("Casing", "Closure", "Spacer", "centering", "Nozzle"):
        assert hw not in raws


def test_cti_listings_match_the_catalog_end_to_end():
    """Parse the fixture and run the real matcher against a small CTI catalog."""
    import sqlite3

    from hpr_finder.db import find_motor_id, init_schema, upsert_motors
    from hpr_finder.models import Motor

    def _m(common, prop):
        return Motor(
            manufacturer=CESARONI, designation=f"54{common}-X", common_name=common,
            diameter_mm=54, length_mm=None, total_impulse_ns=None, avg_thrust_n=None,
            burn_time_s=None, propellant=prop, impulse_class="K", delays=None,
            delay_adjustable=True,
        )

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_schema(conn)
    upsert_motors(conn, [
        _m("K530", "Smoky Sam"), _m("K515", "Skidmark"), _m("K650", "Smoky Sam"),
        _m("K261", "White"), _m("K675", "Skidmark"),
    ])
    for l in _cti_listings():
        mid = find_motor_id(conn, l.manufacturer, l.motor_designation, l.raw_title, l.diameter_mm)
        assert mid is not None, f"{l.motor_designation} ({l.raw_title}) did not match"
