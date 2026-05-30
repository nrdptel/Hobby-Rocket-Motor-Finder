"""Parse-level tests for the csrocketry scraper using captured HTML fixtures."""
from pathlib import Path

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.csrocketry import (
    _availability_to_status,
    _extract_product_jsonld,
)
import re
from hpr_finder.scrapers.csrocketry import STOCK_LEVEL_RE

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text()


def test_instock_h242t_parses_jsonld():
    html = _load("csrocketry_h242t_instock.html")
    product = _extract_product_jsonld(html)
    assert product is not None
    assert "H242T-14A" in product["name"]
    assert product["sku"] == "971"
    offers = product["offers"]
    assert offers["price"] == "44.99"
    assert offers["priceCurrency"] == "USD"
    assert "InStock" in offers["availability"]


def test_instock_h242t_stock_count():
    html = _load("csrocketry_h242t_instock.html")
    m = STOCK_LEVEL_RE.search(html)
    assert m is not None
    assert int(m.group(1)) == 29


def test_instock_h242t_status_with_count():
    html = _load("csrocketry_h242t_instock.html")
    status = _availability_to_status("https://schema.org/InStock", 29, html)
    assert status is StockStatus.IN_STOCK_WITH_COUNT


def test_oos_j825r_parses_jsonld():
    html = _load("csrocketry_j825r_oos.html")
    product = _extract_product_jsonld(html)
    assert product is not None
    assert "J825R-14A" in product["name"]
    offers = product["offers"]
    assert "OutOfStock" in offers["availability"]


def test_oos_j825r_no_stock_count():
    html = _load("csrocketry_j825r_oos.html")
    assert STOCK_LEVEL_RE.search(html) is None


def test_oos_j825r_status():
    html = _load("csrocketry_j825r_oos.html")
    status = _availability_to_status("https://schema.org/OutOfStock", None, html)
    assert status is StockStatus.OUT_OF_STOCK


def test_lowstock_h73j_stock_count_is_1():
    html = _load("csrocketry_h73j_lowstock.html")
    m = STOCK_LEVEL_RE.search(html)
    assert m is not None
    assert int(m.group(1)) == 1


def test_o6000_with_invalid_json_escape_still_parses():
    # The O6000 product description contains "AeroTech\'s" (invalid JSON escape).
    # Strict json.loads fails; the scraper should recover by stripping bad escapes.
    html = _load("csrocketry_o6000_oos_bad_escape.html")
    product = _extract_product_jsonld(html)
    assert product is not None
    assert "O6000" in product["name"]
    offers = product["offers"]
    assert offers["price"] == "9999.99"  # placeholder OOS price; verify it parsed
    assert "OutOfStock" in offers["availability"]


def test_k400c_with_invalid_json_escape_still_parses():
    html = _load("csrocketry_k400c_oos_bad_escape.html")
    product = _extract_product_jsonld(html)
    assert product is not None
    assert "K400C-14A" in product["name"]
    offers = product["offers"]
    assert "OutOfStock" in offers["availability"]
