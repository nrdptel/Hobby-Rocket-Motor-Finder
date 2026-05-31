"""Parse-level tests for the Wildman scraper using captured HTML fixtures."""
from pathlib import Path

from hpr_finder.scrapers.wildman import _extract_product_blob, _is_delay_variant

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text()


def test_i161w_blob_parses():
    html = _load("wildman_i161w.html")
    p = _extract_product_blob(html)
    assert p is not None
    assert p["title"] == "I161W-14A"
    assert p["vendor"] == "AEROTECH"
    assert len(p["variants"]) == 1


def test_i161w_variant_has_inventory():
    html = _load("wildman_i161w.html")
    p = _extract_product_blob(html)
    v = p["variants"][0]
    assert v["sku"] == "2710"
    assert v["price"] == 6199
    assert v["available"] is True
    assert v["inventory_quantity"] == 7
    assert v["inventory_policy"] == "deny"


def test_default_title_is_not_delay_variant():
    assert _is_delay_variant({"title": "Default Title"}) is False


def test_numeric_title_is_delay_variant():
    assert _is_delay_variant({"title": "4"}) is True
    assert _is_delay_variant({"title": "10"}) is True
    assert _is_delay_variant({"title": "14"}) is True


def test_named_variant_is_not_delay():
    assert _is_delay_variant({"title": "Small"}) is False
    assert _is_delay_variant({"title": "Red"}) is False
