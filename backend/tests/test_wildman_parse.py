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
    _variant_to_listing,
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


def test_cti_listings_skips_hardware_titled_product():
    # A CTI URL that slipped through whose title names a hardware item, not a motor.
    scraper = WildmanScraper()
    url = "https://wildmanrocketry.com/products/pr98-case"
    variants = [{"id": 1, "title": "x", "available": True}]
    assert scraper._cti_listings("O3400-CTI Casing", url, url, variants) == []


# --- AeroTech _scrape_product: skips + multi-variant delay fan-out ------------


@pytest.mark.asyncio
async def test_scrape_product_skips_when_no_blob():
    listings = await WildmanScraper()._scrape_product(
        _FakeClient("<html>no inline product json</html>"), "https://wildmanrocketry.com/products/x"
    )
    assert listings == []


@pytest.mark.asyncio
async def test_scrape_product_skips_other_brands():
    html = (
        '<script type="application/json">'
        '{"title":"Loki H100","vendor":"LOKI","variants":[{"id":1,"title":"Default Title"}]}'
        "</script>"
    )
    listings = await WildmanScraper()._scrape_product(_FakeClient(html), "https://wildmanrocketry.com/products/x")
    assert listings == []


@pytest.mark.asyncio
async def test_scrape_product_skips_when_no_variants():
    html = '<script type="application/json">{"title":"AeroTech H100W","vendor":"AEROTECH","variants":[]}</script>'
    listings = await WildmanScraper()._scrape_product(_FakeClient(html), "https://wildmanrocketry.com/products/x")
    assert listings == []


_AT_MULTI_BLOB = (
    '<script type="application/json">'
    '{"title":"AeroTech H100W White Lightning","vendor":"AEROTECH",'
    '"options":[{"name":"Delay"}],'
    '"variants":['
    '{"id":1,"title":"6","sku":"S6","price":4999,"available":true,"inventory_quantity":3,"inventory_policy":"deny"},'
    '{"id":2,"title":"10","sku":"S10","price":4999,"available":false,"inventory_policy":"deny"},'
    '{"id":3,"title":"14","sku":"S14","price":4999,"available":true,"inventory_policy":"deny"}'
    "]}"
    "</script>"
)


@pytest.mark.asyncio
async def test_scrape_product_aerotech_fans_out_delay_variants():
    listings = await WildmanScraper()._scrape_product(
        _FakeClient(_AT_MULTI_BLOB), "https://wildmanrocketry.com/products/h100w"
    )
    assert len(listings) == 3
    by_v = {l.url.rsplit("variant=", 1)[1]: l for l in listings}
    assert set(by_v) == {"1", "2", "3"}
    assert by_v["1"].status is StockStatus.IN_STOCK_WITH_COUNT and by_v["1"].stock_count == 3
    assert by_v["2"].status is StockStatus.OUT_OF_STOCK
    # available=True but no inventory_quantity -> plain IN_STOCK, no count.
    assert by_v["3"].status is StockStatus.IN_STOCK and by_v["3"].stock_count is None
    assert all(l.manufacturer == "AeroTech" for l in listings)


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


# --- scrape() orchestration + _discover_product_urls -------------------------


class _DiscoverClient:
    """Sitemap index -> one product sub-sitemap -> AeroTech + Cesaroni URLs."""

    async def get(self, url, **kwargs):
        if "sitemap_products_" in url:
            return _FakeResp(
                "https://wildmanrocketry.com/products/i161w-14a "
                "https://wildmanrocketry.com/products/pr98-6gxl-i"
            )
        if "sitemap" in url:
            return _FakeResp("<loc>https://wildmanrocketry.com/sitemap_products_1.xml</loc>")
        return _FakeResp("")


@pytest.mark.asyncio
async def test_discover_product_urls_walks_the_sitemap_index():
    urls = await WildmanScraper()._discover_product_urls(_DiscoverClient())
    assert "https://wildmanrocketry.com/products/i161w-14a" in urls
    assert "https://wildmanrocketry.com/products/pr98-6gxl-i" in urls


@pytest.mark.asyncio
async def test_discover_tolerates_a_failing_sub_sitemap():
    class _SubSitemapFails(_DiscoverClient):
        async def get(self, url, **kwargs):
            if "sitemap_products_" in url:
                raise RuntimeError("sub-sitemap down")
            return await super().get(url, **kwargs)

    urls = await WildmanScraper()._discover_product_urls(_SubSitemapFails())
    assert urls == set()


@pytest.mark.asyncio
async def test_scrape_with_explicit_urls_respects_limit():
    scraper = WildmanScraper()
    listings = await scraper.scrape(
        _FakeClient(_load("wildman_i161w.html")),
        only_urls=[
            "https://wildmanrocketry.com/products/i161w-14a",
            "https://wildmanrocketry.com/products/another",
        ],
        limit=1,
    )
    assert len(listings) == 1


@pytest.mark.asyncio
async def test_scrape_isolates_a_failing_product():
    class _MixedClient:
        async def get(self, url, **kwargs):
            if "bad" in url:
                raise RuntimeError("network blip")
            return _FakeResp(_load("wildman_i161w.html"))

    listings = await WildmanScraper().scrape(
        _MixedClient(),
        only_urls=["https://wildmanrocketry.com/products/good-i161w", "https://wildmanrocketry.com/products/bad"],
    )
    assert len(listings) == 1


@pytest.mark.asyncio
async def test_scrape_discovers_then_builds_listings():
    class _FullClient(_DiscoverClient):
        async def get(self, url, **kwargs):
            if "sitemap" in url:
                return await super().get(url, **kwargs)
            return _FakeResp(_load("wildman_i161w.html"))  # any product URL -> fixture

    listings = await WildmanScraper().scrape(_FullClient())
    assert len(listings) == 2  # both discovered product URLs become listings


def test_extract_product_blob_skips_non_object_and_invalid_json():
    html = (
        '<script type="application/json">[1,2,3]</script>'  # array, not an object
        '<script type="application/json">{"vendor":"AEROTECH","variants": oops}</script>'  # invalid JSON
        '<script type="application/json">'
        '{"title":"AeroTech H100W","vendor":"AEROTECH","variants":[{"id":1,"title":"Default Title"}]}'
        "</script>"
    )
    blob = _extract_product_blob(html)
    assert blob is not None and blob["title"] == "AeroTech H100W"


def test_variant_to_listing_multivariant_empty_designation_is_blank():
    v = {"id": 5, "title": "6", "available": True, "inventory_quantity": 2}
    listing = _variant_to_listing(
        vendor_slug="wildman", product_title="t", canonical_url="https://w/p",
        variant=v, motor_designation="", propellant_code="W", is_single_variant=False,
    )
    assert listing.motor_designation == ""  # no base designation -> empty synthetic
