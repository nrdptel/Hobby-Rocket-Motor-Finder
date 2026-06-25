"""Parse-level tests for the Wildman scraper.

The scraper reads every product + variant from Shopify's ``/products.json``
(no per-product HTML fetch), so these tests drive product dicts shaped like
products.json through ``scrape`` / ``_product_to_listings`` / ``_discover_products``,
plus unit tests for the shared listing helpers.
"""
import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.wildman import (
    CTI_PRODUCT_URL_RE,
    PRODUCT_URL_RE,
    WildmanScraper,
    _cti_diameter_from_url,
    _is_delay_variant,
    _variant_to_listing,
)

# --- _is_delay_variant ---------------------------------------------------------


def test_default_title_is_not_delay_variant():
    assert _is_delay_variant({"title": "Default Title"}) is False


def test_numeric_title_is_delay_variant():
    assert _is_delay_variant({"title": "4"}) is True
    assert _is_delay_variant({"title": "10"}) is True
    assert _is_delay_variant({"title": "14"}) is True


def test_named_variant_is_not_delay():
    assert _is_delay_variant({"title": "Small"}) is False
    assert _is_delay_variant({"title": "Red"}) is False


# --- Cesaroni (CTI) handle regexes + diameter ---------------------------------


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


# --- _variant_to_listing -------------------------------------------------------


def test_variant_to_listing_unknown_status_and_non_numeric_price():
    # No 'available' key -> UNKNOWN; non-numeric price -> None; multi-variant URL.
    v = {"id": 9, "title": "6", "sku": "S", "price": "n/a"}
    listing = _variant_to_listing(
        vendor_slug="wildman", product_title="t", canonical_url="https://w/p",
        variant=v, motor_designation="H100W", propellant_code="W", is_single_variant=False,
    )
    assert listing.status is StockStatus.UNKNOWN
    assert listing.price_cents is None
    assert listing.url == "https://w/p?variant=9"
    assert listing.motor_designation == "H100W-6W"


def test_variant_to_listing_multivariant_empty_designation_is_blank():
    v = {"id": 5, "title": "6", "available": True, "inventory_quantity": 2}
    listing = _variant_to_listing(
        vendor_slug="wildman", product_title="t", canonical_url="https://w/p",
        variant=v, motor_designation="", propellant_code="W", is_single_variant=False,
    )
    assert listing.motor_designation == ""  # no base designation -> empty synthetic


def test_variant_to_listing_counts_when_inventory_quantity_present():
    # The helper still reports an exact count if a source ever supplies it
    # (products.json does not, so this stays a unit-level guarantee).
    v = {"id": 1, "title": "Default Title", "available": True, "inventory_quantity": 7}
    listing = _variant_to_listing(
        vendor_slug="wildman", product_title="t", canonical_url="https://w/p",
        variant=v, motor_designation="H100W", propellant_code="", is_single_variant=True,
    )
    assert listing.status is StockStatus.IN_STOCK_WITH_COUNT
    assert listing.stock_count == 7


# --- _cti_listings (variant dicts in directly) --------------------------------


def test_cti_listing_prefers_in_stock_variant():
    # variants[0] is sold out; a later variant is in stock. The single CTI
    # listing should reflect the buyable variant's status and price.
    scraper = WildmanScraper()
    url = "https://wildmanrocketry.com/products/pr75-5g-r"
    variants = [
        {"id": 1, "title": "P", "price": 19999, "available": False},
        {"id": 2, "title": "Long", "price": 20999, "available": True},
    ]
    listings = scraper._cti_listings("M1810-CTI Red", url, url, variants)
    assert len(listings) == 1
    l = listings[0]
    assert l.status is StockStatus.IN_STOCK
    assert l.price_cents == 20999  # the in-stock variant, not the sold-out 19999


def test_cti_listing_no_variants_is_dropped():
    scraper = WildmanScraper()
    url = "https://wildmanrocketry.com/products/pr75-5g-r"
    assert scraper._cti_listings("M1810-CTI Red", url, url, []) == []


def test_cti_listings_skips_hardware_titled_product():
    # A CTI URL that slipped through whose title names a hardware item, not a motor.
    scraper = WildmanScraper()
    url = "https://wildmanrocketry.com/products/pr98-case"
    variants = [{"id": 1, "title": "x", "available": True}]
    assert scraper._cti_listings("O3400-CTI Casing", url, url, variants) == []


# --- _product_to_listings (product dict -> Listings) --------------------------


def test_product_to_listings_aerotech_single_variant():
    product = {
        "vendor": "AEROTECH", "title": "I161W-14A", "handle": "i161w-14a",
        "variants": [{"id": 1, "title": "Default Title", "sku": "2710", "price": 6199, "available": True}],
    }
    listings = WildmanScraper()._product_to_listings(product)
    assert len(listings) == 1
    l = listings[0]
    assert l.manufacturer == "AeroTech"
    assert l.diameter_mm is None
    assert "I161W" in l.motor_designation
    assert l.status is StockStatus.IN_STOCK  # products.json has no inventory_quantity
    assert l.price_cents == 6199
    assert l.url == "https://wildmanrocketry.com/products/i161w-14a"  # single-variant: no ?variant


def test_product_to_listings_cti_single_listing():
    product = {
        "vendor": "CESARONI TECHNOLOGY", "title": "M1810-CTI Red", "handle": "pr75-5g-r",
        "variants": [{"id": 1, "title": "P", "price": 20999, "available": True}],
    }
    listings = WildmanScraper()._product_to_listings(product)
    assert len(listings) == 1
    l = listings[0]
    assert l.manufacturer == "Cesaroni Technology"
    assert l.motor_designation == "M1810"   # commonName, from "M1810-CTI Red"
    assert l.diameter_mm == 75              # from pr75 handle
    assert l.status is StockStatus.IN_STOCK
    assert "Red" in l.raw_title


def test_product_to_listings_skips_other_brands():
    product = {"vendor": "LOKI", "title": "Loki H100", "handle": "h100",
               "variants": [{"id": 1, "title": "Default Title"}]}
    assert WildmanScraper()._product_to_listings(product) == []


def test_product_to_listings_skips_when_no_variants():
    product = {"vendor": "AEROTECH", "title": "AeroTech H100W", "handle": "h100w", "variants": []}
    assert WildmanScraper()._product_to_listings(product) == []


def test_product_to_listings_fans_out_delay_variants():
    product = {
        "vendor": "AEROTECH", "title": "AeroTech H100W White Lightning", "handle": "h100w",
        "options": [{"name": "Delay"}],
        "variants": [
            {"id": 1, "title": "6", "sku": "S6", "price": 4999, "available": True},
            {"id": 2, "title": "10", "sku": "S10", "price": 4999, "available": False},
            {"id": 3, "title": "14", "sku": "S14", "price": 4999, "available": True},
        ],
    }
    listings = WildmanScraper()._product_to_listings(product)
    assert len(listings) == 3
    by_v = {l.url.rsplit("variant=", 1)[1]: l for l in listings}
    assert set(by_v) == {"1", "2", "3"}
    # No inventory_quantity in products.json -> available reads plain IN_STOCK.
    assert by_v["1"].status is StockStatus.IN_STOCK
    assert by_v["2"].status is StockStatus.OUT_OF_STOCK
    assert by_v["3"].status is StockStatus.IN_STOCK
    assert all(l.manufacturer == "AeroTech" for l in listings)


# --- products.json plumbing + scrape orchestration ----------------------------


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
async def test_discover_products_keeps_motor_shaped_handles_and_normalizes_price():
    pages = [[
        {"vendor": "AEROTECH", "title": "I161W-14A", "handle": "i161w-14a",
         "variants": [{"id": 1, "price": "61.99"}]},
        {"vendor": "CESARONI TECHNOLOGY", "title": "O3400-CTI IMAX", "handle": "pr98-6gxl-i",
         "variants": [{"id": 2, "price": "380.00"}]},
        {"vendor": "WILDMAN BRAND", "title": "Launch Pad", "handle": "launch-pad-high-power",
         "variants": [{"id": 3, "price": "5.00"}]},   # non-motor handle -> dropped
        {"vendor": "AEROTECH", "title": "FirstFire Igniter", "handle": "firstfire-igniter",
         "variants": [{"id": 4, "price": "1.00"}]},   # non-motor handle -> dropped
    ]]
    products = await WildmanScraper()._discover_products(_PagedClient(pages))
    handles = {p["handle"] for p in products}
    assert handles == {"i161w-14a", "pr98-6gxl-i"}
    # Dollar-string price normalized to integer cents in place.
    prices = {p["handle"]: p["variants"][0]["price"] for p in products}
    assert prices["i161w-14a"] == 6199


@pytest.mark.asyncio
async def test_scrape_builds_aerotech_and_cti_listings():
    pages = [[
        {"vendor": "AEROTECH", "title": "I161W-14A", "handle": "i161w-14a",
         "variants": [{"id": 1, "title": "Default Title", "sku": "2710", "price": "61.99", "available": True}]},
        {"vendor": "CESARONI TECHNOLOGY", "title": "O3400-CTI IMAX", "handle": "pr98-6gxl-i",
         "variants": [{"id": 2, "title": "P", "price": "380.00", "available": True}]},
    ]]
    listings = await WildmanScraper().scrape(_PagedClient(pages))
    assert len(listings) == 2
    assert {l.manufacturer for l in listings} == {"AeroTech", "Cesaroni Technology"}


@pytest.mark.asyncio
async def test_scrape_only_urls_filters_by_handle_and_respects_limit():
    pages = [[
        {"vendor": "AEROTECH", "title": "I161W-14A", "handle": "i161w-14a",
         "variants": [{"id": 1, "title": "Default Title", "sku": "2710", "price": "61.99", "available": True}]},
        {"vendor": "AEROTECH", "title": "H128W", "handle": "h128w",
         "variants": [{"id": 2, "title": "Default Title", "sku": "x", "price": "40.00", "available": True}]},
    ]]
    listings = await WildmanScraper().scrape(
        _PagedClient(pages),
        only_urls=["https://wildmanrocketry.com/products/i161w-14a"],
        limit=1,
    )
    assert len(listings) == 1
    assert "I161W" in listings[0].motor_designation


@pytest.mark.asyncio
async def test_scrape_isolates_a_failing_product():
    class _Boom(WildmanScraper):
        def _product_to_listings(self, product):
            if product.get("handle") == "i9bad":
                raise RuntimeError("boom")
            return super()._product_to_listings(product)

    pages = [[
        {"vendor": "AEROTECH", "title": "I161W-14A", "handle": "i161w-14a",
         "variants": [{"id": 1, "title": "Default Title", "sku": "2710", "price": "61.99", "available": True}]},
        {"vendor": "AEROTECH", "title": "H128W", "handle": "i9bad",
         "variants": [{"id": 2, "title": "Default Title", "sku": "x", "price": "40.00", "available": True}]},
    ]]
    listings = await _Boom().scrape(_PagedClient(pages))
    assert len(listings) == 1
    assert "I161W" in listings[0].motor_designation
