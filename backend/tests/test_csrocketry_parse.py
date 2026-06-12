"""Parse-level tests for the csrocketry scraper using captured HTML fixtures."""
import gzip
from pathlib import Path

import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.csrocketry import (
    STOCK_LEVEL_RE,
    CSRocketryScraper,
    _availability_to_status,
    _diameter_at_least,
    _extract_product_jsonld,
    _parse_jsonld_block,
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


@pytest.mark.asyncio
async def test_scrape_product_without_jsonld_raises():
    scraper = CSRocketryScraper()
    with pytest.raises(ValueError):
        await scraper._scrape_product(_FakeClient("<html>no product</html>"), "https://x/y.html")


# --- _diameter_at_least -------------------------------------------------------


def test_diameter_at_least_aerotech_and_cti():
    at38 = "https://www.csrocketry.com/rocket-motors/aerotech-rocketry/motors/38mm/aerotech-h242t.html"
    cti38 = "https://www.csrocketry.com/rocket-motors/cesaroni/motors/pro-38/cesaroni-i170.html"
    assert _diameter_at_least(at38, 38) is True
    assert _diameter_at_least(at38, 54) is False
    assert _diameter_at_least(cti38, 29) is True  # pro-38 -> 38mm
    assert _diameter_at_least("https://www.csrocketry.com/x/y.html", 1) is False  # no diameter


# --- _sitemap_text (gzip + fallback) -----------------------------------------


@pytest.mark.asyncio
async def test_sitemap_text_gunzips_compressed_body():
    class _GzClient:
        async def get(self, url, **kwargs):
            r = _FakeResp("")
            r.content = gzip.compress(b"<urlset>hello sitemap</urlset>")
            return r

    text = await CSRocketryScraper()._sitemap_text(_GzClient())
    assert "hello sitemap" in text


@pytest.mark.asyncio
async def test_sitemap_text_falls_back_on_uncompressed_body():
    class _PlainClient:
        async def get(self, url, **kwargs):
            r = _FakeResp("")
            r.content = b"<urlset>plain not gzipped</urlset>"
            return r

    text = await CSRocketryScraper()._sitemap_text(_PlainClient())
    assert "plain not gzipped" in text


_SITEMAP_INDEX = (
    '<?xml version="1.0"?><sitemapindex>'
    "<sitemap><loc>https://www.csrocketry.com/sitemap_1.xml.gz</loc></sitemap>"
    "</sitemapindex>"
)
_SUB_SITEMAP = (
    "<urlset><url><loc>https://www.csrocketry.com/rocket-motors/"
    "aerotech-rocketry/motors/38mm/aerotech-h242t-14a-rocket-motor.html</loc></url></urlset>"
)


@pytest.mark.asyncio
async def test_sitemap_text_follows_index_to_gzipped_subsitemaps():
    # The top-level URL is a sitemap *index*; follow its <loc> to the (gzipped)
    # sub-sitemap and return the concatenated page URLs.
    class _IndexClient:
        async def get(self, url, **kwargs):
            r = _FakeResp("")
            if "sitemap_1" in url:
                r.content = gzip.compress(_SUB_SITEMAP.encode())
            else:
                r.content = _SITEMAP_INDEX.encode()
            return r

    text = await CSRocketryScraper()._sitemap_text(_IndexClient())
    assert "aerotech-h242t-14a-rocket-motor.html" in text


@pytest.mark.asyncio
async def test_sitemap_text_tolerates_a_failing_subsitemap():
    class _IndexFailsClient:
        async def get(self, url, **kwargs):
            if "sitemap_1" in url:
                raise RuntimeError("sub-sitemap fetch failed")
            r = _FakeResp("")
            r.content = _SITEMAP_INDEX.encode()
            return r

    text = await CSRocketryScraper()._sitemap_text(_IndexFailsClient())
    assert text == ""  # index parsed, sole sub-sitemap failed -> nothing collected


# --- discovery + scrape orchestration ----------------------------------------

# An AeroTech product, a Cesaroni product, and an AeroTech sub-category page
# (whose crawl yields a second AeroTech product) — exercises both brand trees.
_AT_PRODUCT = (
    "https://www.csrocketry.com/rocket-motors/aerotech-rocketry/motors/"
    "38mm/aerotech-h242t-14a-rocket-motor.html"
)
_CTI_PRODUCT = (
    "https://www.csrocketry.com/rocket-motors/cesaroni/motors/"
    "pro-38/cesaroni-i170-14a-classic-rocket-motor.html"
)
_AT_SUBCAT = "https://www.csrocketry.com/rocket-motors/aerotech-rocketry/motors/54mm-reloads.html"
_AT_PRODUCT_2 = (
    "https://www.csrocketry.com/rocket-motors/aerotech-rocketry/motors/"
    "54mm/aerotech-j825r-14a-rocket-motor.html"
)
_SITEMAP_TEXT = " ".join([_AT_PRODUCT, _CTI_PRODUCT, _AT_SUBCAT])
_SUBCAT_HTML = f'<a href="{_AT_PRODUCT_2}">J825R</a>'


class _DiscoverClient:
    """Routes sitemap / sub-category / product fetches for discovery tests."""

    def __init__(self, product_html: str):
        self._product = product_html

    async def get(self, url, **kwargs):
        if "sitemap" in url:
            r = _FakeResp("")
            r.content = _SITEMAP_TEXT.encode()  # plain bytes -> decode fallback
            return r
        if "-reloads.html" in url:
            return _FakeResp(_SUBCAT_HTML)
        return _FakeResp(self._product)


@pytest.mark.asyncio
async def test_discover_product_urls_unions_sitemap_and_subcat_crawl():
    urls = await CSRocketryScraper()._discover_product_urls(_DiscoverClient(""))
    assert urls == {_AT_PRODUCT, _CTI_PRODUCT, _AT_PRODUCT_2}


@pytest.mark.asyncio
async def test_scrape_explicit_urls_with_limit():
    scraper = CSRocketryScraper()
    client = _FakeClient(_load("csrocketry_h242t_instock.html"))
    listings = await scraper.scrape(client, only_urls=[_AT_PRODUCT, _AT_PRODUCT_2], limit=1)
    assert len(listings) == 1


@pytest.mark.asyncio
async def test_scrape_discovery_applies_min_diameter_filter():
    scraper = CSRocketryScraper()
    scraper.min_diameter_mm = 54  # drops the 38mm AeroTech + pro-38 Cesaroni
    client = _DiscoverClient(_load("csrocketry_h242t_instock.html"))
    listings = await scraper.scrape(client)
    # Only the 54mm product (j825r) survives the >=54 filter.
    assert len(listings) == 1


@pytest.mark.asyncio
async def test_scrape_isolates_a_failing_product():
    class _MixedClient:
        async def get(self, url, **kwargs):
            if "good" in url:
                return _FakeResp(_load("csrocketry_h242t_instock.html"))
            return _FakeResp("<html>broken — no json-ld</html>")

    listings = await CSRocketryScraper().scrape(
        _MixedClient(), only_urls=["https://x/good.html", "https://x/bad.html"]
    )
    assert len(listings) == 1


@pytest.mark.asyncio
async def test_discover_tolerates_a_failing_subcategory_fetch():
    class _SubcatFails(_DiscoverClient):
        async def get(self, url, **kwargs):
            if "-reloads.html" in url:
                raise RuntimeError("subcat down")
            return await super().get(url, **kwargs)

    urls = await CSRocketryScraper()._discover_product_urls(_SubcatFails(""))
    # The sitemap products survive; the failed sub-category just adds nothing.
    assert urls == {_AT_PRODUCT, _CTI_PRODUCT}


# --- JSON-LD parsing + availability branches ---------------------------------


def test_parse_jsonld_block_returns_none_for_irreparable_json():
    # Broken in a way the invalid-escape cleanup can't fix -> None (not a raise).
    assert _parse_jsonld_block("{ totally [not] valid json ") is None


def test_extract_product_jsonld_skips_unparseable_block():
    assert _extract_product_jsonld('<script type="application/ld+json">{broken</script>') is None


def test_extract_product_jsonld_reads_graph_product():
    html = (
        '<script type="application/ld+json">'
        '{"@graph":[{"@type":"WebPage"},{"@type":"Product","name":"Graph Motor"}]}'
        "</script>"
    )
    p = _extract_product_jsonld(html)
    assert p is not None and p["name"] == "Graph Motor"


def test_availability_out_of_stock_via_page_text():
    # No structured availability, but the page text signals OOS.
    assert (
        _availability_to_status("", None, "This item is currently out of stock.")
        is StockStatus.OUT_OF_STOCK
    )


def test_availability_unknown_when_no_signal():
    assert _availability_to_status("", None, "no stock signal here") is StockStatus.UNKNOWN


def test_availability_in_stock_without_a_count():
    # InStock but the page has no "Stock Level: N" -> plain IN_STOCK, not …WITH_COUNT.
    assert (
        _availability_to_status("http://schema.org/InStock", None, "<html>no level</html>")
        is StockStatus.IN_STOCK
    )


@pytest.mark.asyncio
async def test_scrape_product_with_offers_as_a_list():
    # Some products encode `offers` as a one-element array rather than an object.
    html = (
        '<script type="application/ld+json">'
        '{"@type":"Product","name":"Aerotech H242T-14A","sku":"9",'
        '"offers":[{"price":"44.99","priceCurrency":"USD","availability":"http://schema.org/InStock"}]}'
        "</script>"
    )
    listing = await CSRocketryScraper()._scrape_product(_FakeClient(html), _AT_PRODUCT)
    assert "H242T" in listing.motor_designation
    assert listing.price_cents == 4499
    assert listing.status is StockStatus.IN_STOCK
