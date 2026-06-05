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

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.sirius import (
    H1_RE,
    PRODUCT_URL_RE,
    TOTAL_PRODUCTS_RE,
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
