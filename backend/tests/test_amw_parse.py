"""Parse-level tests for the AMW scraper using a captured category-page fixture.

AMW is unusual in that *all* the info we care about (designation, stock count,
price, status) lives in the category listing — no per-product fetch needed.
This fixture is one of the larger DMS category pages so the parser is
exercised across many statuses.
"""
from pathlib import Path

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.amw import AMWScraper, _parse_status
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


def test_price_to_cents_normal():
    assert price_to_cents("33.14") == 3314
    assert price_to_cents("600.09") == 60009


def test_price_to_cents_none():
    assert price_to_cents(None) is None


def test_price_to_cents_bogus():
    assert price_to_cents("not-a-price") is None
