"""Parse-level tests for the BuyRocketMotors scraper using captured HTML fixtures."""
from pathlib import Path

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.buyrocketmotors import (
    _availability_to_status,
    _extract_product_jsonld,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text()


def test_oos_h238t_parses_jsonld():
    html = _load("buyrocketmotors_h238t_oos.html")
    p = _extract_product_jsonld(html)
    assert p is not None
    assert "H238T-14A" in p["name"]
    offers = p["offers"] if isinstance(p["offers"], dict) else p["offers"][0]
    assert offers["price"] == 33.24
    assert offers["priceCurrency"] == "USD"
    assert "outofstock" in offers["availability"].lower()


def test_instock_h148r_parses_jsonld():
    html = _load("buyrocketmotors_h148r.html")
    p = _extract_product_jsonld(html)
    assert p is not None
    assert "H148R-14A" in p["name"]
    offers = p["offers"] if isinstance(p["offers"], dict) else p["offers"][0]
    assert "instock" in offers["availability"].lower()


def test_availability_mapping():
    assert _availability_to_status("http://schema.org/InStock") is StockStatus.IN_STOCK
    assert _availability_to_status("https://schema.org/OutOfStock") is StockStatus.OUT_OF_STOCK
    assert _availability_to_status("schema.org/PreOrder") is StockStatus.SPECIAL_ORDER
    assert _availability_to_status("") is StockStatus.UNKNOWN
