"""Parse-level tests for the Loki Research scraper.

Loki's single reloads page is one ``<tr>`` per motor in invalid HTML (nested
``<a>`` tags), so the scraper splits rows with regex rather than a DOM parser —
a DOM parser restructures the bad markup and emits duplicate, mis-scoped rows.
Fixture: the live reloads page captured 2026-06.
"""
from pathlib import Path

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.loki import _classify_status, _price_cents, parse_reloads

FIXTURES = Path(__file__).parent / "fixtures"


def _load() -> str:
    return (FIXTURES / "loki_reloads.html").read_text()


def _by_designation(listings, desig):
    return next(l for l in listings if l.motor_designation == desig)


def test_parses_one_listing_per_product_no_dupes():
    listings = parse_reloads(_load())
    assert len(listings) >= 48
    # Every row is a real motor with a normalized designation.
    assert all(l.motor_designation for l in listings)
    # Exactly one listing per store product id — the DOM-mangling that produced
    # duplicate rows must not recur.
    assert len({l.sku for l in listings}) == len(listings)


def test_listings_tagged_for_loki_catalog_routing():
    listings = parse_reloads(_load())
    assert all(l.vendor_slug == "loki" for l in listings)
    # Must be the exact name ThrustCurve stores, so the matcher hits the Loki catalog.
    assert all(l.manufacturer == "Loki Research" for l in listings)


def test_in_stock_motor_fields():
    listing = _by_designation(parse_reloads(_load()), "N5500-LW")
    assert listing.status == StockStatus.IN_STOCK
    assert listing.price_cents == 229900  # $2,299.00
    assert listing.sku == "4420245464133"
    assert listing.url == "https://lokiresearch.com/secure/storeDetail.asp?id=4420245464133"
    assert listing.stock_count is None  # Loki doesn't publish counts


def test_made_to_order_is_special_order():
    listing = _by_designation(parse_reloads(_load()), "N3800-LW")
    assert listing.status == StockStatus.SPECIAL_ORDER  # "Made to order. Allow 6-8 weeks"
    assert listing.price_cents == 124500


def test_temporarily_out_of_stock():
    listing = _by_designation(parse_reloads(_load()), "M3464-LB")
    assert listing.status == StockStatus.OUT_OF_STOCK
    assert listing.price_cents == 75900


def test_hp_prefixed_g_class_reloads_are_captured():
    # Cells like "HP-G-69-SF" must normalize to the catalog commonName (G69), not
    # be dropped — they're real G-class reloads.
    desigs = {l.motor_designation for l in parse_reloads(_load())}
    assert "G69-SF" in desigs
    assert "G94-IB" in desigs


# --- status / price helpers -------------------------------------------------

def test_classify_status_precedence():
    assert _classify_status("foo TEMPORARILY OUT OF STOCK bar") == StockStatus.OUT_OF_STOCK
    assert _classify_status("Made to order. Allow 6-8 weeks for delivery") == StockStatus.SPECIAL_ORDER
    # "with out tracking smoke" must NOT trip the out-of-stock check.
    assert _classify_status("NEW N-5500 BATES with out tracking smoke $2,299.00") == StockStatus.IN_STOCK


def test_price_cents_from_cells():
    assert _price_cents(["N-3800-LW", "Loki White", "$1,245.00"]) == 124500
    assert _price_cents(["no price here"]) is None
