"""Parse-level tests for the Sirius Rocketry scraper.

Sirius runs Zen Cart with several theme quirks:
  * Price class is ``productSalePrice`` (theme-specific) when on sale, falling
    back to ``productGeneralPrice`` or ``normalprice`` — the helper has to
    pick the price the customer would actually pay.
  * Stock status is signalled by the presence of ``button_in_cart`` vs
    ``button_sold_out`` image references, NOT by JSON-LD or structured data.
  * "Special order" items appear with the sold-out button + the string
    "Special Order" in the page title — a third state distinct from OOS.

The three fixtures here exercise one each of in-stock / special-order /
out-of-stock plus the URL-id and product-URL regexes used at discovery time.
"""
import re
from pathlib import Path

import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.sirius import (
    H1_RE,
    PRODUCT_URL_RE,
    TOTAL_PRODUCTS_RE,
    SiriusScraper,
    _classify_status,
    _extract_price_cents,
    _product_id_from_url,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text()


def _extract_title(html: str) -> str:
    h1 = H1_RE.search(html)
    assert h1, "expected an <h1> in the fixture"
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h1.group(1))).strip()


# --- in-stock fixture -------------------------------------------------------

def test_in_stock_price_and_status():
    html = _load("sirius_g138t_instock.html")
    title = _extract_title(html)
    assert "G138T-14A" in title
    assert _extract_price_cents(html) == 2783  # $27.83
    assert _classify_status(html, title) is StockStatus.IN_STOCK


# --- special-order fixture --------------------------------------------------

def test_special_order_price_and_status():
    html = _load("sirius_k1999n_special.html")
    title = _extract_title(html)
    assert "K1999N-P" in title
    assert "special order" in title.lower()  # title carries the marker
    assert _extract_price_cents(html) == 20559  # $205.59
    assert _classify_status(html, title) is StockStatus.SPECIAL_ORDER


# --- out-of-stock fixture ---------------------------------------------------

def test_out_of_stock_price_and_status():
    html = _load("sirius_h112j_oos.html")
    title = _extract_title(html)
    assert "H112J" in title
    assert _extract_price_cents(html) == 5393  # $53.93
    assert _classify_status(html, title) is StockStatus.OUT_OF_STOCK


# --- URL helper -------------------------------------------------------------

def test_product_id_from_url():
    assert _product_id_from_url(
        "https://www.siriusrocketry.biz/ishop/aerotech-g138t-14a-hpr-reload-kit-hazmat-744.html"
    ) == "744"
    # No numeric ID — Sirius's category index pages don't carry one.
    assert _product_id_from_url("https://www.siriusrocketry.biz/ishop/high-power-rocket-motors-hdw-57/") is None


# --- discovery regexes ------------------------------------------------------

def test_product_url_regex_matches_aerotech_slugs():
    html = '<a href="https://www.siriusrocketry.biz/ishop/aerotech-g138t-14a-hpr-reload-kit-hazmat-744.html">'
    matches = PRODUCT_URL_RE.findall(html)
    assert len(matches) == 1
    assert matches[0].endswith("-744.html")


def test_product_url_regex_matches_enerjet_slugs():
    """EnerJet by AeroTech motors live at a different URL prefix — the
    paginator must catch them or we lose AeroTech E-class motors."""
    html = '<a href="https://www.siriusrocketry.biz/ishop/enerjet-by-aerotech-e30-4t-24mm-single-use-motor-1281.html">'
    assert len(PRODUCT_URL_RE.findall(html)) == 1


def test_product_url_regex_skips_non_aerotech_slugs():
    """The AeroTech manufacturer page sometimes lists cross-referenced
    Sirius/Estes items. Filter screens them so we don't fetch every page."""
    html = '<a href="https://www.siriusrocketry.biz/ishop/sirius-rocketry-thrust-ring-tool-set-1653.html">'
    assert PRODUCT_URL_RE.findall(html) == []


def test_total_products_regex_extracts_pagination_count():
    """The total-products footer tells us how many AeroTech products the
    manufacturer page advertises — used to sanity-check pagination."""
    html = (
        '<div id="productsListingTopNumber" class="navSplitPagesResult back">'
        'Displaying <strong>1</strong> to <strong>50</strong> '
        '(of <strong>537</strong> Products)</div>'
    )
    m = TOTAL_PRODUCTS_RE.search(html)
    assert m and m.group(1) == "537"


# --- _extract_price_cents preference order ---------------------------------

def _price_block(inner: str) -> str:
    """Wrap price spans in Sirius's main 'Product Price block' so the scoped
    extractor sees them (it ignores prices outside this block)."""
    return f'<h2 id="productPrices" class="productGeneral">{inner}</h2> <!--eof Product Price block -->'


def test_price_preference_sale_over_normal():
    """When a product is on sale, productSalePrice (Sirius theme) takes
    precedence over the struck-through normalprice MSRP."""
    html = _price_block(
        '<span class="normalprice">$705.99</span>'
        '<span class="productSalePrice">Sale:&nbsp;$614.21</span>'
    )
    # Sale price wins (the actual cart price), not MSRP.
    assert _extract_price_cents(html) == 61421


def test_price_general_when_no_sale():
    """Bare productGeneralPrice (no sale) is used when present."""
    html = _price_block('<span class="productGeneralPrice">$33.14</span>')
    assert _extract_price_cents(html) == 3314


def test_price_base_when_only_base_price_present():
    """Many Sirius products render only ``productBasePrice`` (no sale/special/
    general row). Without recognising it the price showed on the page but the
    listing recorded None — the gap this fix closes."""
    html = _price_block('<span class="productBasePrice">$455.99</span>')
    assert _extract_price_cents(html) == 45599


def test_price_base_with_thousands_separator():
    """Base-price N/O-class motors run over $1,000 — the comma must parse."""
    html = _price_block('<span class="productBasePrice">$1,383.00</span>')
    assert _extract_price_cents(html) == 138300


def test_price_general_preferred_over_base():
    """When both rows are present, the general (cart) price wins over base."""
    html = _price_block(
        '<span class="productBasePrice">$99.99</span>'
        '<span class="productGeneralPrice">$33.14</span>'
    )
    assert _extract_price_cents(html) == 3314


def test_price_none_when_no_price_present():
    assert _extract_price_cents("<p>no price here</p>") is None


# --- _extract_price_cents: ignore rotating related-product boxes ------------

def test_price_ignores_also_purchased_box_leak():
    """The main block's price wins over a different product's price rendered in
    a lower 'also purchased' / 'what's new' box — the bug that made a sold-out
    listing's price oscillate run-to-run."""
    html = (
        _price_block('<span class="productSalePrice">Sale:&nbsp;$53.93</span>')
        + '<div id="alsoPurchased">'
        '<span class="productSalePrice">Sale:&nbsp;$277.19</span></div>'
    )
    assert _extract_price_cents(html) == 5393


def test_price_none_when_main_block_priceless_despite_leak():
    """When the main product shows no price, return None — never a price from a
    rotating related-product box outside the block."""
    html = (
        '<h2 id="productPrices" class="productGeneral">Call for price</h2>'
        " <!--eof Product Price block -->"
        '<div id="alsoPurchased">'
        '<span class="productSalePrice">Sale:&nbsp;$277.19</span></div>'
    )
    assert _extract_price_cents(html) is None


# --- _classify_status: the unknown-state fall-through -------------------------


def test_classify_status_unknown_without_buttons_or_special():
    # No in-cart / sold-out button image and not a special order → UNKNOWN.
    assert _classify_status("<html>no stock buttons</html>", "Aerotech H100W") is StockStatus.UNKNOWN


# --- _scrape_product (HTML -> Listing, via a fake client) --------------------


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
async def test_scrape_product_in_stock_builds_listing():
    scraper = SiriusScraper()
    url = "https://www.siriusrocketry.biz/ishop/aerotech-g138t-14a-hpr-reload-kit-hazmat-744.html"
    listing = await scraper._scrape_product(_FakeClient(_load("sirius_g138t_instock.html")), url)
    assert listing is not None
    assert listing.vendor_slug == "sirius"
    assert "G138T" in listing.motor_designation
    assert listing.status is StockStatus.IN_STOCK
    assert listing.price_cents == 2783
    assert listing.currency == "USD"
    assert listing.sku == "744"
    assert listing.stock_count is None  # Sirius never publishes counts


@pytest.mark.asyncio
async def test_scrape_product_out_of_stock():
    scraper = SiriusScraper()
    url = "https://www.siriusrocketry.biz/ishop/aerotech-h112j-hpr-reload-kit-901.html"
    listing = await scraper._scrape_product(_FakeClient(_load("sirius_h112j_oos.html")), url)
    assert listing.status is StockStatus.OUT_OF_STOCK
    assert listing.price_cents == 5393
    assert listing.sku == "901"


@pytest.mark.asyncio
async def test_scrape_product_special_order():
    scraper = SiriusScraper()
    url = "https://www.siriusrocketry.biz/ishop/aerotech-k1999n-p-hpr-reload-kit-555.html"
    listing = await scraper._scrape_product(_FakeClient(_load("sirius_k1999n_special.html")), url)
    assert listing.status is StockStatus.SPECIAL_ORDER
    assert listing.price_cents == 20559


@pytest.mark.asyncio
async def test_scrape_product_no_h1_raises():
    scraper = SiriusScraper()
    with pytest.raises(ValueError):
        await scraper._scrape_product(_FakeClient("<html>no heading</html>"), "https://x/y-1.html")


@pytest.mark.asyncio
async def test_scrape_product_empty_title_raises():
    scraper = SiriusScraper()
    with pytest.raises(ValueError):
        await scraper._scrape_product(_FakeClient("<h1>   </h1>"), "https://x/y-1.html")


@pytest.mark.asyncio
async def test_scrape_product_non_motor_returns_none():
    # A real page in the crawl whose title isn't a motor (a kit/accessory).
    scraper = SiriusScraper()
    listing = await scraper._scrape_product(_FakeClient("<h1>Rocket Glue Stick</h1>"), "https://x/glue-1.html")
    assert listing is None


# --- scrape() orchestration + _crawl_for_products ----------------------------


_MANUFACTURER_PAGE_1 = (
    '<div id="productsListingTopNumber" class="navSplitPagesResult back">'
    "Displaying <strong>1</strong> to <strong>50</strong> "
    "(of <strong>2</strong> Products)</div>"
    '<a href="https://www.siriusrocketry.biz/ishop/aerotech-g138t-14a-hpr-reload-kit-hazmat-744.html">G138T</a>'
    '<a href="https://www.siriusrocketry.biz/ishop/aerotech-h112j-hpr-reload-kit-901.html">H112J</a>'
)


class _CrawlClient:
    """Page 1 (manufacturer base) lists products; later index-N pages are empty,
    so pagination stops at the first page that yields nothing new."""

    def __init__(self, page1: str):
        self._page1 = page1

    async def get(self, url, **kwargs):
        return _FakeResp(self._page1 if "index-" not in url else "<html>empty</html>")


@pytest.mark.asyncio
async def test_crawl_for_products_paginates_until_empty_page():
    scraper = SiriusScraper()
    urls = await scraper._crawl_for_products(_CrawlClient(_MANUFACTURER_PAGE_1))
    assert urls == {
        "https://www.siriusrocketry.biz/ishop/aerotech-g138t-14a-hpr-reload-kit-hazmat-744.html",
        "https://www.siriusrocketry.biz/ishop/aerotech-h112j-hpr-reload-kit-901.html",
    }


@pytest.mark.asyncio
async def test_scrape_with_explicit_urls_respects_limit():
    scraper = SiriusScraper()
    listings = await scraper.scrape(
        _FakeClient(_load("sirius_g138t_instock.html")),
        only_urls=[
            "https://www.siriusrocketry.biz/ishop/aerotech-g138t-14a-hpr-reload-kit-hazmat-744.html",
            "https://www.siriusrocketry.biz/ishop/aerotech-h112j-hpr-reload-kit-901.html",
        ],
        limit=1,
    )
    assert len(listings) == 1


@pytest.mark.asyncio
async def test_scrape_isolates_a_failing_product():
    class _MixedClient:
        async def get(self, url, **kwargs):
            if "good" in url:
                return _FakeResp(_load("sirius_g138t_instock.html"))
            return _FakeResp("<html>broken — no h1</html>")

    scraper = SiriusScraper()
    listings = await scraper.scrape(
        _MixedClient(),
        only_urls=["https://x/good-1.html", "https://x/bad-2.html"],
    )
    assert len(listings) == 1
    assert "G138T" in listings[0].motor_designation


class _FullClient:
    """Manufacturer pages for discovery; any product URL serves one fixture."""

    def __init__(self, page1: str, product_html: str):
        self._page1 = page1
        self._html = product_html

    async def get(self, url, **kwargs):
        if "manufacturers" in url:
            return _FakeResp(self._page1 if "index-" not in url else "<html></html>")
        return _FakeResp(self._html)


@pytest.mark.asyncio
async def test_scrape_discovers_then_builds_listings():
    scraper = SiriusScraper()
    client = _FullClient(_MANUFACTURER_PAGE_1, _load("sirius_g138t_instock.html"))
    listings = await scraper.scrape(client)
    assert len(listings) == 2  # both discovered product URLs become listings


@pytest.mark.asyncio
async def test_crawl_stops_and_keeps_page1_when_a_later_page_fails():
    # Page 1 yields products; the page-2 fetch raises. The crawl must keep the
    # page-1 URLs and stop (rather than crash), and it never reached an empty
    # page so it logs the pagination-incomplete warning.
    class _FailOnIndexClient:
        async def get(self, url, **kwargs):
            if "index-" in url:
                raise RuntimeError("manufacturer page fetch failed")
            return _FakeResp(_MANUFACTURER_PAGE_1)

    scraper = SiriusScraper()
    urls = await scraper._crawl_for_products(_FailOnIndexClient())
    assert len(urls) == 2
