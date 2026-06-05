"""Parse-level tests for the Moto-Joe Rocketry scraper.

Moto-Joe is OpenCart: motors live under two brand category subtrees, listed with
price on the category page, but stock status only on the product page
(``Availability:`` — a numeric quantity when in stock, "Out Of Stock" otherwise).
Fixtures (captured 2026-06): trimmed AeroTech/Cesaroni category pages and three
product pages (an out-of-stock AeroTech motor, an out-of-stock Cesaroni motor,
and an in-stock item showing a numeric quantity).
"""
from pathlib import Path

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.moto_joe import (
    _AVAIL_RE,
    build_listing,
    classify_availability,
    parse_category,
    parse_diameter,
    total_pages,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# --- category parsing --------------------------------------------------------

def test_parse_category_aerotech():
    rows = parse_category(_load("moto_joe_category_aerotech.html"))
    assert len(rows) >= 6
    assert all(r["product_id"] and r["name"] for r in rows)
    first = rows[0]
    assert first["name"] == "AT M4500ST"
    assert first["price_cents"] == 69300  # $693.00


def test_total_pages_from_results_text():
    assert total_pages(_load("moto_joe_category_aerotech.html")) == 3


def test_parse_category_cesaroni_names_are_commonnames():
    names = [r["name"] for r in parse_category(_load("moto_joe_category_cesaroni.html"))]
    assert "E22-13A" in names


# --- product -> listing ------------------------------------------------------

def test_build_listing_aerotech_out_of_stock():
    listing = build_listing(
        _load("moto_joe_product_oos.html"),
        url="https://www.moto-joe.com/index.php?route=product/product&product_id=258",
        manufacturer="AeroTech",
        price_cents=69300,
        cat_name="AT M4500ST",
    )
    assert listing is not None
    assert listing.motor_designation == "M4500ST"  # "AT " prefix ignored
    assert listing.manufacturer == "AeroTech"
    assert listing.vendor_slug == "moto_joe"
    assert listing.status == StockStatus.OUT_OF_STOCK
    assert listing.sku == "258"
    assert listing.price_cents == 69300


def test_build_listing_cesaroni_carries_flavor_and_diameter():
    listing = build_listing(
        _load("moto_joe_product_cesaroni.html"),
        url="https://www.moto-joe.com/index.php?route=product/product&product_id=451",
        manufacturer="Cesaroni Technology",
        price_cents=2400,
        cat_name="E22-13A",
    )
    assert listing is not None
    assert listing.motor_designation == "E22"  # CTI commonName
    assert listing.manufacturer == "Cesaroni Technology"
    assert listing.diameter_mm == 24  # from "Pro24" in the description
    # Flavor stays in the title so the CTI matcher can disambiguate.
    assert "Smoky Sam" in listing.raw_title


# --- availability ------------------------------------------------------------

def test_build_listing_skips_out_of_scope_brands():
    # Kosdon / AMW motors are filed under the AeroTech category but aren't in our
    # catalog — they must be dropped, not emitted as unmatched.
    kosdon = (
        '<h1>G82W-M</h1><div id="tab-description">Motor reload, 29-150, Kosdon'
        "</div><ul><li>Availability: Out Of Stock</li></ul>"
    )
    assert build_listing(
        kosdon,
        url="https://www.moto-joe.com/index.php?route=product/product&product_id=999",
        manufacturer="AeroTech",
        price_cents=5000,
        cat_name="G82W-M",
    ) is None


def test_classify_availability():
    assert classify_availability("1") == (StockStatus.IN_STOCK_WITH_COUNT, 1)
    assert classify_availability("12") == (StockStatus.IN_STOCK_WITH_COUNT, 12)
    assert classify_availability("0") == (StockStatus.OUT_OF_STOCK, None)
    assert classify_availability("Out Of Stock") == (StockStatus.OUT_OF_STOCK, None)
    assert classify_availability("In Stock") == (StockStatus.IN_STOCK, None)
    assert classify_availability("Pre-Order") == (StockStatus.SPECIAL_ORDER, None)
    assert classify_availability("") == (StockStatus.UNKNOWN, None)


def test_in_stock_product_fixture_parses_numeric_quantity():
    # Real in-stock markup: Availability is a number -> in_stock_with_count.
    m = _AVAIL_RE.search(_load("moto_joe_product_instock.html"))
    assert m is not None
    status, count = classify_availability(m.group(1))
    assert status == StockStatus.IN_STOCK_WITH_COUNT
    assert count == 1


def test_parse_diameter():
    assert parse_diameter("Motor reload, Pro29, 1G, Blue Streak") == 29
    assert parse_diameter("Aerotech motor reload, 98-7680 Super Thunder") == 98
    assert parse_diameter("Motor reload, 24mm") == 24
    assert parse_diameter("RMS-38/720 reload") == 38
    assert parse_diameter("no size mentioned") is None
