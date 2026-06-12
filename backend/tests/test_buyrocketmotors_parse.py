"""Parse-level tests for the BuyRocketMotors scraper using captured HTML fixtures."""
from pathlib import Path

import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.buyrocketmotors import (
    BuyRocketMotorsScraper,
    _availability_to_status,
    _extract_product_jsonld,
    _extract_variants,
    _is_delay_variant,
    _variant_to_listing,
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


def test_extract_jsonld_returns_none_without_product():
    assert _extract_product_jsonld("<html><body>no script</body></html>") is None
    # A non-Product JSON-LD block (e.g. BreadcrumbList) is ignored.
    assert _extract_product_jsonld(
        '<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>'
    ) is None


def test_availability_mapping():
    assert _availability_to_status("http://schema.org/InStock") is StockStatus.IN_STOCK
    assert _availability_to_status("https://schema.org/OutOfStock") is StockStatus.OUT_OF_STOCK
    assert _availability_to_status("schema.org/PreOrder") is StockStatus.SPECIAL_ORDER
    assert _availability_to_status("schema.org/BackOrder") is StockStatus.SPECIAL_ORDER
    assert _availability_to_status("") is StockStatus.UNKNOWN


# --- _is_delay_variant ---------------------------------------------------------


@pytest.mark.parametrize(
    "title,expected",
    [
        ("4", True),
        ("10", True),
        (" 7 ", True),
        ("Default Title", False),
        ("Long", False),
        ("", False),
    ],
)
def test_is_delay_variant(title, expected):
    assert _is_delay_variant({"title": title}) is expected


# --- _extract_variants ---------------------------------------------------------


def test_extract_variants_finds_inline_array():
    html = (
        '<script type="application/json">'
        '[{"id":1,"title":"4","sku":"A","available":true,"price":2100}]'
        "</script>"
    )
    variants = _extract_variants(html)
    assert variants is not None
    assert variants[0]["sku"] == "A"


def test_extract_variants_none_when_array_lacks_variant_shape():
    # An inline JSON array that isn't the variants array (no sku/available/title).
    html = '<script type="application/json">[{"foo":1}]</script>'
    assert _extract_variants(html) is None


def test_extract_variants_none_without_inline_json():
    assert _extract_variants("<html>no inline json</html>") is None


# --- _variant_to_listing -------------------------------------------------------


def _variant(**over):
    base = {"id": 111, "title": "4", "sku": "S1", "price": 2100, "available": True}
    base.update(over)
    return base


def test_variant_to_listing_in_stock_synthesizes_designation():
    listing = _variant_to_listing(
        "buyrocketmotors", "Aerotech D13 White Lightning", "https://brm.test/d13",
        _variant(), "D13", "W", "USD",
    )
    assert listing.vendor_slug == "buyrocketmotors"
    assert listing.motor_designation == "D13-4W"  # base + delay + propellant
    assert listing.status is StockStatus.IN_STOCK
    assert listing.price_cents == 2100  # inline price is already cents
    assert listing.sku == "S1"
    assert listing.currency == "USD"
    assert listing.url == "https://brm.test/d13?variant=111"
    assert listing.raw_title == "Aerotech D13 White Lightning"


def test_variant_to_listing_backorder_is_special_order():
    listing = _variant_to_listing(
        "buyrocketmotors", "t", "u", _variant(available=False, inventory_policy="continue"),
        "D13", "W", "USD",
    )
    assert listing.status is StockStatus.SPECIAL_ORDER


def test_variant_to_listing_sold_out_is_out_of_stock():
    listing = _variant_to_listing(
        "buyrocketmotors", "t", "u", _variant(available=False, inventory_policy="deny"),
        "D13", "W", "USD",
    )
    assert listing.status is StockStatus.OUT_OF_STOCK


def test_variant_to_listing_unknown_availability():
    listing = _variant_to_listing(
        "buyrocketmotors", "t", "u", _variant(available=None), "D13", "W", "USD",
    )
    assert listing.status is StockStatus.UNKNOWN


def test_variant_to_listing_no_variant_id_keeps_canonical_url():
    v = _variant()
    del v["id"]
    listing = _variant_to_listing("buyrocketmotors", "t", "https://brm.test/d13", v, "D13", "W", "USD")
    assert listing.url == "https://brm.test/d13"


def test_variant_to_listing_non_numeric_price_is_none():
    listing = _variant_to_listing(
        "buyrocketmotors", "t", "u", _variant(price="free"), "D13", "W", "USD",
    )
    assert listing.price_cents is None


# --- _scrape_product (HTML -> Listings, via a fake client) ---------------------


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
async def test_scrape_product_instock_single_variant():
    scraper = BuyRocketMotorsScraper()
    url = "https://www.buyrocketmotors.com/products/aerotech-h148r-14a-redline"
    listings = await scraper._scrape_product(_FakeClient(_load("buyrocketmotors_h148r.html")), url)

    assert len(listings) == 1
    l = listings[0]
    assert l.vendor_slug == "buyrocketmotors"
    assert "H148R" in l.motor_designation
    assert l.status is StockStatus.IN_STOCK
    assert l.price_cents == 4274  # 42.74 USD -> cents
    assert l.currency == "USD"
    assert l.sku == "81414"
    assert l.raw_title == "Aerotech H148R-14A Redline"
    assert "variant=" in l.url


@pytest.mark.asyncio
async def test_scrape_product_oos_single_variant():
    scraper = BuyRocketMotorsScraper()
    url = "https://www.buyrocketmotors.com/products/aerotech-h238t-14a-blue-thunder"
    listings = await scraper._scrape_product(_FakeClient(_load("buyrocketmotors_h238t_oos.html")), url)

    assert len(listings) == 1
    l = listings[0]
    assert "H238T" in l.motor_designation
    assert l.status is StockStatus.OUT_OF_STOCK
    assert l.price_cents == 3324


@pytest.mark.asyncio
async def test_scrape_product_without_jsonld_raises():
    scraper = BuyRocketMotorsScraper()
    with pytest.raises(ValueError):
        await scraper._scrape_product(_FakeClient("<html>no product</html>"), "https://brm.test/x")


_MULTI_VARIANT_HTML = (
    '<script type="application/ld+json">'
    '{"@type":"Product","name":"Aerotech D13 White Lightning","sku":"D13",'
    '"offers":{"price":21.0,"priceCurrency":"USD","availability":"http://schema.org/InStock",'
    '"url":"https://www.buyrocketmotors.com/products/aerotech-d13"}}'
    "</script>"
    '<script type="application/json">'
    '[{"id":111,"title":"4","sku":"D13-4","price":2100,"available":true,"inventory_policy":"deny"},'
    '{"id":222,"title":"7","sku":"D13-7","price":2100,"available":false,"inventory_policy":"deny"},'
    '{"id":333,"title":"Default Title","sku":"D13d","price":2100,"available":true,"inventory_policy":"deny"}]'
    "</script>"
)


@pytest.mark.asyncio
async def test_scrape_product_fans_out_delay_variants():
    scraper = BuyRocketMotorsScraper()
    url = "https://www.buyrocketmotors.com/products/aerotech-d13"
    listings = await scraper._scrape_product(_FakeClient(_MULTI_VARIANT_HTML), url)

    # Only the two numeric-delay variants emit listings; "Default Title" is skipped.
    assert len(listings) == 2
    by_variant = {l.url.rsplit("variant=", 1)[1]: l for l in listings}
    assert set(by_variant) == {"111", "222"}
    assert by_variant["111"].status is StockStatus.IN_STOCK
    assert by_variant["222"].status is StockStatus.OUT_OF_STOCK
    assert all(l.price_cents == 2100 for l in listings)
    # Each listing's designation is the per-delay synthesis (base + delay + propellant).
    assert by_variant["111"].motor_designation == "D13-4W"


# --- JSON-LD / variants edge cases --------------------------------------------


def test_extract_jsonld_skips_bad_json_and_reads_graph():
    html = (
        "<script type=\"application/ld+json\">{bad json}</script>"
        '<script type="application/ld+json">'
        '{"@graph":[{"@type":"WebPage"},{"@type":"Product","name":"Aerotech H148R-14A"}]}'
        "</script>"
    )
    p = _extract_product_jsonld(html)
    assert p is not None and "H148R" in p["name"]


def test_extract_variants_skips_bad_json_and_empty_array():
    # First inline array is invalid JSON, then an empty array, then the real one.
    html = (
        '<script type="application/json">[not json</script>'
        '<script type="application/json">[]</script>'
        '<script type="application/json">[{"id":1,"title":"4","sku":"A","available":true}]</script>'
    )
    v = _extract_variants(html)
    assert v is not None and v[0]["sku"] == "A"


def test_variant_to_listing_empty_designation_yields_empty_synthetic():
    listing = _variant_to_listing("buyrocketmotors", "t", "u", _variant(), "", "W", "USD")
    assert listing.motor_designation == ""


# --- discovery + scrape orchestration -----------------------------------------


class _JsonResp:
    def __init__(self, data: dict):
        self._data = data

    def raise_for_status(self):
        return None

    def json(self):
        return self._data


class _PagedClient:
    """Serves /products.json pages keyed by ?page=N, then empties to stop."""

    def __init__(self, pages: list[list[dict]]):
        self._pages = pages

    async def get(self, url, **kwargs):
        import re

        m = re.search(r"page=(\d+)", url)
        page = int(m.group(1)) if m else 1
        products = self._pages[page - 1] if page - 1 < len(self._pages) else []
        return _JsonResp({"products": products})


@pytest.mark.asyncio
async def test_discover_product_urls_filters_to_aerotech_motors():
    scraper = BuyRocketMotorsScraper()
    pages = [
        [
            {"vendor": "AEROTECH", "title": "Aerotech H148R-14A Redline", "handle": "aerotech-h148r-14a-redline"},
            {"vendor": "Cesaroni", "title": "Pro54 K660 example", "handle": "cti-k660"},  # wrong vendor
            {"vendor": "AEROTECH", "title": "Rocket Glue", "handle": "glue"},  # no designation
            {"vendor": "AEROTECH", "title": "Aerotech I280DM-14A", "handle": ""},  # no handle
        ]
    ]
    urls = await scraper._discover_product_urls(_PagedClient(pages))
    assert urls == {"https://www.buyrocketmotors.com/products/aerotech-h148r-14a-redline"}


class _DiscoverThenProductClient:
    """products.json -> JSON pages; any other URL -> the product fixture HTML."""

    def __init__(self, pages: list[list[dict]], product_html: str):
        self._paged = _PagedClient(pages)
        self._html = product_html

    async def get(self, url, **kwargs):
        if "products.json" in url:
            return await self._paged.get(url)
        return _FakeResp(self._html)


@pytest.mark.asyncio
async def test_scrape_with_explicit_urls():
    scraper = BuyRocketMotorsScraper()
    listings = await scraper.scrape(
        _FakeClient(_load("buyrocketmotors_h148r.html")),
        only_urls=["https://www.buyrocketmotors.com/products/aerotech-h148r-14a-redline"],
    )
    assert len(listings) == 1
    assert "H148R" in listings[0].motor_designation


@pytest.mark.asyncio
async def test_scrape_discovers_then_caps_with_limit():
    scraper = BuyRocketMotorsScraper()
    pages = [
        [
            {"vendor": "AEROTECH", "title": "Aerotech H148R-14A Redline", "handle": "aerotech-h148r-14a-redline"},
            {"vendor": "AEROTECH", "title": "Aerotech H238T-14A Blue Thunder", "handle": "aerotech-h238t-14a-blue-thunder"},
        ]
    ]
    client = _DiscoverThenProductClient(pages, _load("buyrocketmotors_h148r.html"))
    listings = await scraper.scrape(client, limit=1)
    assert len(listings) == 1  # two discovered, capped to one


@pytest.mark.asyncio
async def test_scrape_isolates_a_failing_product():
    # A product whose page has no JSON-LD raises inside _scrape_product; scrape()
    # must swallow it and keep going (returning the other product's listing).
    class _MixedClient:
        async def get(self, url, **kwargs):
            if "good" in url:
                return _FakeResp(_load("buyrocketmotors_h148r.html"))
            return _FakeResp("<html>broken</html>")

    scraper = BuyRocketMotorsScraper()
    listings = await scraper.scrape(
        _MixedClient(),
        only_urls=["https://www.buyrocketmotors.com/products/good", "https://www.buyrocketmotors.com/products/bad"],
    )
    assert len(listings) == 1
    assert "H148R" in listings[0].motor_designation
