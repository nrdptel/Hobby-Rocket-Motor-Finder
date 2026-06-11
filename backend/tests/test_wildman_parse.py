"""Parse-level tests for the Wildman scraper using captured HTML fixtures."""
from pathlib import Path

import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.wildman import (
    CTI_PRODUCT_URL_RE,
    PRODUCT_URL_RE,
    WildmanScraper,
    _cti_diameter_from_url,
    _extract_product_blob,
    _is_delay_variant,
)

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


# --- Cesaroni (CTI) -------------------------------------------------------

def test_cti_discovery_matches_pr_handles_not_p_hardware():
    """Motor handles are pr<dia> (pr98-…); hardware is p<dia> (p98-rr) and must
    NOT be picked up. AeroTech discovery stays disjoint from CTI discovery."""
    text = " ".join([
        "https://wildmanrocketry.com/products/pr98-6gxl-i",       # CTI motor
        "https://wildmanrocketry.com/products/p98-rr",            # CTI hardware
        "https://wildmanrocketry.com/products/i161w-14a",          # AeroTech motor
    ])
    cti = set(CTI_PRODUCT_URL_RE.findall(text))
    at = set(PRODUCT_URL_RE.findall(text))
    assert "https://wildmanrocketry.com/products/pr98-6gxl-i" in cti
    assert "https://wildmanrocketry.com/products/p98-rr" not in cti
    # AeroTech regex must not swallow the pr98 CTI handle.
    assert "https://wildmanrocketry.com/products/pr98-6gxl-i" not in at


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://wildmanrocketry.com/products/pr98-6gxl-i", 98),
        ("https://wildmanrocketry.com/products/pr38-3g-x", 38),
        ("https://wildmanrocketry.com/products/pr75-5g-r", 75),
        ("https://wildmanrocketry.com/products/k261-white-long-burn", None),
    ],
)
def test_cti_diameter_from_url(url, expected):
    assert _cti_diameter_from_url(url) == expected


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
async def test_scrape_cti_instock_single_listing():
    scraper = WildmanScraper()
    url = "https://wildmanrocketry.com/products/pr75-5g-r"
    client = _FakeClient(_load("wildman_cti_m1810_red_instock.html"))
    listings = await scraper._scrape_product(client, url)

    assert len(listings) == 1  # one listing per CTI product, no delay fan-out
    l = listings[0]
    assert l.manufacturer == "Cesaroni Technology"
    assert l.motor_designation == "M1810"     # commonName, from "M1810-CTI Red"
    assert l.diameter_mm == 75                 # from pr75 handle
    assert l.status is StockStatus.IN_STOCK_WITH_COUNT
    assert l.stock_count == 1
    assert l.vendor_slug == "wildman"
    assert "Red" in l.raw_title                # flavor stays in the title for matching


@pytest.mark.asyncio
async def test_scrape_cti_oos_negative_inventory():
    scraper = WildmanScraper()
    url = "https://wildmanrocketry.com/products/pr98-6gxl-i"
    client = _FakeClient(_load("wildman_cti_o3400_imax_oos.html"))
    listings = await scraper._scrape_product(client, url)

    assert len(listings) == 1
    l = listings[0]
    assert l.manufacturer == "Cesaroni Technology"
    assert l.motor_designation == "O3400"
    assert l.diameter_mm == 98
    assert l.status is StockStatus.OUT_OF_STOCK   # available False -> OOS
    assert l.stock_count is None


@pytest.mark.asyncio
async def test_scrape_aerotech_unchanged_by_cti_routing():
    """Regression: an AeroTech Wildman product still parses as AeroTech with no
    diameter hint."""
    scraper = WildmanScraper()
    url = "https://wildmanrocketry.com/products/i161w-14a"
    client = _FakeClient(_load("wildman_i161w.html"))
    listings = await scraper._scrape_product(client, url)

    assert len(listings) == 1
    assert listings[0].manufacturer == "AeroTech"
    assert listings[0].diameter_mm is None
    assert "I161W" in listings[0].motor_designation


def test_cti_listing_prefers_in_stock_variant():
    # variants[0] is sold out; a later variant is in stock. The single CTI
    # listing should reflect the buyable variant's status and price, not the
    # sold-out variants[0].
    scraper = WildmanScraper()
    url = "https://wildmanrocketry.com/products/pr75-5g-r"
    variants = [
        {"id": 1, "title": "P", "price": 19999, "available": False, "inventory_policy": "deny"},
        {"id": 2, "title": "Long", "price": 20999, "available": True, "inventory_quantity": 3},
    ]
    listings = scraper._cti_listings("M1810-CTI Red", url, url, variants)

    assert len(listings) == 1
    l = listings[0]
    assert l.status is StockStatus.IN_STOCK_WITH_COUNT
    assert l.stock_count == 3
    assert l.price_cents == 20999  # the in-stock variant, not the sold-out 19999


def test_cti_listing_no_variants_is_dropped():
    scraper = WildmanScraper()
    url = "https://wildmanrocketry.com/products/pr75-5g-r"
    assert scraper._cti_listings("M1810-CTI Red", url, url, []) == []
