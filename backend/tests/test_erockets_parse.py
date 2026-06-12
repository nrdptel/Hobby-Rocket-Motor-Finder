"""Parse-level tests for the eRockets scraper.

eRockets is a BigCommerce store; we scrape its AeroTech motor category pages
(``<li class="product">`` cards) for name/price/stock without per-product fetches.
Fixture: a slice of the live AeroTech single-use + reloadable category pages
(2026-06) with in-stock motors, an out-of-stock motor, an out-of-production motor,
two RMS reloads (variant products shown as "Choose Options"), and three non-motor
cards (grease, a wrench, a charge canister) that must be skipped.
"""
from pathlib import Path

import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.erockets import (
    ERocketsScraper,
    _classify_status,
    parse_category,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def _listings():
    return parse_category((FIXTURES / "erockets_category.html").read_text(encoding="utf-8"))


def _by(listings, desig):
    return next(l for l in listings if l.motor_designation == desig)


def test_parses_motors_skips_non_motors():
    listings = _listings()
    # 8 AeroTech motors; grease / wrench / charge-canister cards skipped.
    assert len(listings) == 8
    assert all(l.manufacturer == "AeroTech" for l in listings)
    assert all(l.vendor_slug == "erockets" for l in listings)
    assert all(l.motor_designation for l in listings)
    titles = " ".join(l.raw_title.lower() for l in listings)
    assert "grease" not in titles and "wrench" not in titles and "canister" not in titles


def test_in_stock_single_use_motor():
    l = _by(_listings(), "F26-9FJ")
    assert l.status == StockStatus.IN_STOCK
    assert l.price_cents == 3599
    assert l.url.startswith("https://www.erockets.biz/")


def test_out_of_stock_motor():
    l = _by(_listings(), "F30-8FJ")
    assert l.status == StockStatus.OUT_OF_STOCK
    assert l.price_cents == 2599
    assert l.sku == "7336"  # data-product-id


def test_reload_with_variants_counts_as_in_stock():
    # RMS reloads show "Choose Options" (delay variants), not "Add to Cart".
    l = _by(_listings(), "H165R-14A")
    assert l.status == StockStatus.IN_STOCK


def test_out_of_production_motor_still_listed():
    # OOP motors (slug tagged "-oop") are kept; they match via the catalog OOP pass.
    assert _by(_listings(), "F52-12C").status == StockStatus.IN_STOCK


def test_card_with_nested_li_is_not_truncated():
    # A card containing a nested <li> (option swatch / badge) must still parse —
    # the splitter keys on card start, not a non-greedy ...</li>.
    html = (
        '<ul class="productGrid">'
        '<li class="product">'
        '<ul class="productOptions"><li>Choose delay</li></ul>'
        '<h4 class="card-title"><a href="https://www.erockets.biz/aerotech-h128w-14a/">'
        "Aerotech 29mm RMS H128W-14A (1pk)</a></h4>"
        '<span class="price">$34.99</span>'
        "<button>Add to Cart</button>"
        "</li></ul>"
    )
    listings = parse_category(html)
    assert len(listings) == 1
    assert listings[0].motor_designation == "H128W-14A"
    assert listings[0].status == StockStatus.IN_STOCK
    assert listings[0].price_cents == 3499


def test_parse_category_skips_card_without_a_title():
    # Matches the product-card shape but has no card-title link -> skipped.
    assert parse_category('<li class="product foo">no card-title link here</li>') == []


def test_classify_status_unknown_without_cart_or_stock_words():
    assert _classify_status('<div class="card">just a description</div>') is StockStatus.UNKNOWN


# --- scrape() orchestration --------------------------------------------------


class _FakeResp:
    def __init__(self, text: str):
        self.text = text

    def raise_for_status(self):
        return None


class _CategoryClient:
    """Serves the category fixture for page 1 of any category, empty afterwards."""

    def __init__(self, page1_html: str):
        self._page1 = page1_html

    async def get(self, url, **kwargs):
        return _FakeResp(self._page1 if "page=1" in url else "<html></html>")


@pytest.mark.asyncio
async def test_scrape_walks_categories_and_dedups_urls():
    listings = await ERocketsScraper().scrape(_CategoryClient(_load("erockets_category.html")))
    assert len(listings) > 0
    # Each category serves the same fixture; URLs are deduped across them.
    assert len({l.url for l in listings}) == len(listings)


@pytest.mark.asyncio
async def test_scrape_respects_limit():
    listings = await ERocketsScraper().scrape(_CategoryClient(_load("erockets_category.html")), limit=1)
    assert len(listings) == 1


@pytest.mark.asyncio
async def test_scrape_only_urls_filters_to_requested():
    client = _CategoryClient(_load("erockets_category.html"))
    everything = await ERocketsScraper().scrape(client)
    target = everything[0].url
    filtered = await ERocketsScraper().scrape(
        _CategoryClient(_load("erockets_category.html")), only_urls=[target]
    )
    assert [l.url for l in filtered] == [target]
