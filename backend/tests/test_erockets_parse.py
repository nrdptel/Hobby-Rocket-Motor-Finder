"""Parse-level tests for the eRockets scraper.

eRockets is a BigCommerce store; we scrape its AeroTech motor category pages
(``<li class="product">`` cards) for name/price/stock without per-product fetches.
Fixture: a slice of the live AeroTech single-use + reloadable category pages
(2026-06) with in-stock motors, an out-of-stock motor, an out-of-production motor,
two RMS reloads (variant products shown as "Choose Options"), and three non-motor
cards (grease, a wrench, a charge canister) that must be skipped.
"""
from pathlib import Path

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.erockets import parse_category

FIXTURES = Path(__file__).parent / "fixtures"


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
