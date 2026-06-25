"""Parse-level tests for the BuyRocketMotors scraper.

The scraper reads every product + variant straight from Shopify's
``/products.json`` (no per-product HTML fetch), so these tests drive product
dicts shaped like products.json through ``scrape`` / ``_product_to_listings``,
plus unit tests for the shared ``_variant_to_listing`` helper.
"""
import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.buyrocketmotors import (
    BuyRocketMotorsScraper,
    _is_delay_variant,
    _variant_to_listing,
)

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


# --- _variant_to_listing (variant prices are integer cents post-normalization) -


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
    assert listing.price_cents == 2100  # already integer cents
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


def test_variant_to_listing_empty_designation_yields_empty_synthetic():
    listing = _variant_to_listing("buyrocketmotors", "t", "u", _variant(), "", "W", "USD")
    assert listing.motor_designation == ""


# --- products.json plumbing: fake paged client ---------------------------------


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


# --- discovery: vendor + designation filter ------------------------------------


@pytest.mark.asyncio
async def test_discover_filters_to_aerotech_motors():
    scraper = BuyRocketMotorsScraper()
    pages = [
        [
            {"vendor": "AEROTECH", "title": "Aerotech H148R-14A Redline",
             "handle": "aerotech-h148r-14a-redline", "variants": [{"id": 1, "price": "1.00"}]},
            {"vendor": "Cesaroni", "title": "Pro54 K660 example", "handle": "cti-k660",
             "variants": [{"id": 2, "price": "1.00"}]},  # wrong vendor
            {"vendor": "AEROTECH", "title": "Rocket Glue", "handle": "glue",
             "variants": [{"id": 3, "price": "1.00"}]},  # no designation
        ]
    ]
    products = await scraper._discover_products(_PagedClient(pages))
    handles = {p["handle"] for p in products}
    assert handles == {"aerotech-h148r-14a-redline"}
    # Prices normalized dollar-string -> integer cents in place.
    assert products[0]["variants"][0]["price"] == 100


# --- scrape() end-to-end over products.json ------------------------------------


@pytest.mark.asyncio
async def test_scrape_single_variant_in_stock():
    pages = [[{
        "vendor": "AEROTECH", "title": "Aerotech H148R-14A Redline",
        "handle": "aerotech-h148r-14a-redline",
        "variants": [{"id": 111, "title": "Default Title", "sku": "81414",
                      "price": "42.74", "available": True}],
    }]]
    listings = await BuyRocketMotorsScraper().scrape(_PagedClient(pages))
    assert len(listings) == 1
    l = listings[0]
    assert "H148R" in l.motor_designation
    assert l.status is StockStatus.IN_STOCK
    assert l.price_cents == 4274        # 42.74 USD -> cents
    assert l.sku == "81414"
    assert l.currency == "USD"
    # Single-variant URL keeps the ?variant={id} suffix (stable listing key).
    assert l.url == "https://www.buyrocketmotors.com/products/aerotech-h148r-14a-redline?variant=111"


@pytest.mark.asyncio
async def test_scrape_single_variant_out_of_stock():
    pages = [[{
        "vendor": "AEROTECH", "title": "Aerotech H238T-14A Blue Thunder",
        "handle": "aerotech-h238t-14a-blue-thunder",
        "variants": [{"id": 9, "title": "Default Title", "sku": "x", "price": "33.24", "available": False}],
    }]]
    listings = await BuyRocketMotorsScraper().scrape(_PagedClient(pages))
    assert len(listings) == 1
    assert listings[0].status is StockStatus.OUT_OF_STOCK
    assert listings[0].price_cents == 3324


@pytest.mark.asyncio
async def test_scrape_fans_out_delay_variants():
    pages = [[{
        "vendor": "AEROTECH", "title": "Aerotech D13 White Lightning", "handle": "aerotech-d13",
        "options": [{"name": "Delay"}],
        "variants": [
            {"id": 111, "title": "4", "sku": "D13-4", "price": "21.00", "available": True},
            {"id": 222, "title": "7", "sku": "D13-7", "price": "21.00", "available": False},
            {"id": 333, "title": "Default Title", "sku": "D13d", "price": "21.00", "available": True},
        ],
    }]]
    listings = await BuyRocketMotorsScraper().scrape(_PagedClient(pages))
    # Only the two numeric-delay variants emit listings; "Default Title" is skipped.
    assert len(listings) == 2
    by_variant = {l.url.rsplit("variant=", 1)[1]: l for l in listings}
    assert set(by_variant) == {"111", "222"}
    assert by_variant["111"].status is StockStatus.IN_STOCK
    assert by_variant["222"].status is StockStatus.OUT_OF_STOCK
    assert all(l.price_cents == 2100 for l in listings)
    assert by_variant["111"].motor_designation == "D13-4W"


@pytest.mark.asyncio
async def test_scrape_caps_with_limit():
    pages = [[
        {"vendor": "AEROTECH", "title": "Aerotech H148R-14A Redline", "handle": "h148r",
         "variants": [{"id": 1, "title": "Default Title", "sku": "a", "price": "1.00", "available": True}]},
        {"vendor": "AEROTECH", "title": "Aerotech H238T-14A Blue Thunder", "handle": "h238t",
         "variants": [{"id": 2, "title": "Default Title", "sku": "b", "price": "1.00", "available": True}]},
    ]]
    listings = await BuyRocketMotorsScraper().scrape(_PagedClient(pages), limit=1)
    assert len(listings) == 1  # two discovered, capped to one


@pytest.mark.asyncio
async def test_scrape_with_only_urls_filters_by_handle():
    pages = [[
        {"vendor": "AEROTECH", "title": "Aerotech H148R-14A Redline", "handle": "aerotech-h148r-14a-redline",
         "variants": [{"id": 1, "title": "Default Title", "sku": "a", "price": "1.00", "available": True}]},
        {"vendor": "AEROTECH", "title": "Aerotech H238T-14A Blue Thunder", "handle": "aerotech-h238t-14a-blue-thunder",
         "variants": [{"id": 2, "title": "Default Title", "sku": "b", "price": "1.00", "available": True}]},
    ]]
    listings = await BuyRocketMotorsScraper().scrape(
        _PagedClient(pages),
        only_urls=["https://www.buyrocketmotors.com/products/aerotech-h148r-14a-redline"],
    )
    assert len(listings) == 1
    assert "H148R" in listings[0].motor_designation


@pytest.mark.asyncio
async def test_scrape_isolates_a_failing_product():
    # A product that raises inside _product_to_listings must be swallowed so the
    # rest of the catalog still publishes.
    class _Boom(BuyRocketMotorsScraper):
        def _product_to_listings(self, product):
            if product.get("handle") == "bad":
                raise RuntimeError("boom")
            return super()._product_to_listings(product)

    pages = [[
        {"vendor": "AEROTECH", "title": "Aerotech H148R-14A Redline", "handle": "good",
         "variants": [{"id": 1, "title": "Default Title", "sku": "a", "price": "1.00", "available": True}]},
        {"vendor": "AEROTECH", "title": "Aerotech H238T-14A Blue Thunder", "handle": "bad",
         "variants": [{"id": 2, "title": "Default Title", "sku": "b", "price": "1.00", "available": True}]},
    ]]
    listings = await _Boom().scrape(_PagedClient(pages))
    assert len(listings) == 1
    assert "H148R" in listings[0].motor_designation
