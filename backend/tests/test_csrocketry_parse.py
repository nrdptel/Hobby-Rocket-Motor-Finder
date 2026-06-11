"""Parse-level tests for the csrocketry scraper using captured HTML fixtures."""
from pathlib import Path

import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.csrocketry import (
    STOCK_LEVEL_RE,
    CSRocketryScraper,
    _availability_to_status,
    _extract_product_jsonld,
    _pro_size_diameter,
)

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


def test_instock_zero_count_is_out_of_stock():
    # An InStock schema with a parsed count of 0 is sold out, not
    # in-stock-with-count-zero (mirrors the n>0 guards in other scrapers).
    status = _availability_to_status("https://schema.org/InStock", 0, "")
    assert status is StockStatus.OUT_OF_STOCK


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


# --- Cesaroni (CTI) -------------------------------------------------------

CTI_PRODUCT = (
    "https://www.csrocketry.com/rocket-motors/cesaroni/motors/pro-38/3g-reloads/"
    "cesaroni-i170-14a-classic-rocket-motor.html"
)
CTI_CATEGORY = "https://www.csrocketry.com/rocket-motors/cesaroni/motors/pro-38/3g-reloads.html"


def test_cti_product_url_regex_matches_products_not_categories():
    text = f'<a href="{CTI_PRODUCT}">x</a> <a href="{CTI_CATEGORY}">cat</a>'
    products = CSRocketryScraper._extract_cti_product_urls(text)
    assert CTI_PRODUCT in products
    assert CTI_CATEGORY not in products


def test_cti_subcategory_excludes_products():
    text = f'{CTI_PRODUCT} {CTI_CATEGORY}'
    subcats = CSRocketryScraper._extract_cti_subcategory_urls(text)
    assert CTI_CATEGORY in subcats
    assert CTI_PRODUCT not in subcats


def test_aerotech_and_cti_discovery_are_disjoint_by_brand():
    """An AeroTech product URL must not be picked up by the CTI extractor."""
    at = ("https://www.csrocketry.com/rocket-motors/aerotech-rocketry/motors/"
          "29mm-reloads/h242t-14a-blue-thunder.html")
    assert CSRocketryScraper._extract_cti_product_urls(at) == set()


@pytest.mark.parametrize(
    "url,expected",
    [
        (CTI_PRODUCT, 38),
        ("https://www.csrocketry.com/rocket-motors/cesaroni/motors/pro-24/1g-reloads/x.html", 24),
        ("https://www.csrocketry.com/rocket-motors/cesaroni/motors/pro-98/6g-reloads/x.html", 98),
        ("https://www.csrocketry.com/rocket-motors/aerotech-rocketry/motors/29mm/x.html", None),
    ],
)
def test_pro_size_diameter(url, expected):
    assert _pro_size_diameter(url) == expected


class _FakeResp:
    def __init__(self, text: str):
        self.text = text
        self.content = text.encode()

    def raise_for_status(self):
        return None


class _FakeClient:
    """Returns one fixture body for any GET — enough to drive _scrape_product."""
    def __init__(self, body: str):
        self._body = body

    async def get(self, url, **kwargs):
        return _FakeResp(self._body)


@pytest.mark.asyncio
async def test_scrape_cti_instock_listing_is_tagged_cesaroni():
    scraper = CSRocketryScraper()
    client = _FakeClient(_load("csrocketry_cti_i170_classic.html"))
    listing = await scraper._scrape_product(client, CTI_PRODUCT)

    assert listing.manufacturer == "Cesaroni Technology"
    assert listing.motor_designation == "I170"   # commonName, no propellant letter
    assert listing.diameter_mm == 38              # from /pro-38/
    assert listing.status is StockStatus.IN_STOCK_WITH_COUNT
    assert listing.stock_count == 9
    assert listing.price_cents == 7539
    assert listing.vendor_slug == "csrocketry"    # same vendor, not a new one


@pytest.mark.asyncio
async def test_scrape_cti_oos_listing():
    scraper = CSRocketryScraper()
    url = ("https://www.csrocketry.com/rocket-motors/cesaroni/motors/pro-54/6gxl-reloads/"
           "cesaroni-k815-p-skidmark-rocket-motor.html")
    client = _FakeClient(_load("csrocketry_cti_k815_oos.html"))
    listing = await scraper._scrape_product(client, url)

    assert listing.manufacturer == "Cesaroni Technology"
    assert listing.motor_designation == "K815"
    assert listing.diameter_mm == 54
    assert listing.status is StockStatus.OUT_OF_STOCK
    assert listing.stock_count is None


@pytest.mark.asyncio
async def test_scrape_aerotech_product_unchanged_by_cti_routing():
    """Regression: an AeroTech product URL still yields an AeroTech-tagged
    listing with no diameter hint."""
    scraper = CSRocketryScraper()
    at_url = ("https://www.csrocketry.com/rocket-motors/aerotech-rocketry/motors/"
              "29mm-reloads/aerotech-h242t-14a.html")
    client = _FakeClient(_load("csrocketry_h242t_instock.html"))
    listing = await scraper._scrape_product(client, at_url)

    assert listing.manufacturer == "AeroTech"
    assert listing.diameter_mm is None
    assert "H242T" in listing.motor_designation
