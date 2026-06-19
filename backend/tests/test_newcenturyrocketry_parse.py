"""Parse-level tests for the New Century Rocketry scraper.

New Century is scraped entirely from Shopify's ``products.json`` (no per-product
pages), so the fixtures here are product dicts shaped like that endpoint returns
(verified against the live store): a ``vendor`` brand, a ``title`` with the motor
designation, and ``variants`` with ``title`` / ``price`` (a "$" string) /
``available`` / ``sku`` / ``id``.
"""
import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.newcenturyrocketry import (
    NewCenturyRocketryScraper,
    _is_delay_variant,
    _status,
    parse_products,
)


def _variant(**over):
    base = {"id": 111, "title": "Default Title", "price": "62.99", "available": True, "sku": "091814"}
    base.update(over)
    return base


def _product(**over):
    base = {
        "vendor": "Aerotech",
        "title": "Aerotech RMS-38/360 I180W-14A White Lightning Model Rocket Motor Reload Kit",
        "handle": "aerotech-rms-38-360-i180w-14a-white-lightning",
        "variants": [_variant()],
    }
    base.update(over)
    return base


# --- _is_delay_variant ---------------------------------------------------------


@pytest.mark.parametrize(
    "title,expected",
    [
        ("-4", True),
        ("-7", True),
        ("-10", True),
        ("4", True),     # bare digits (no hyphen) also count
        (" -5 ", True),
        ("Default Title", False),
        ("Long", False),
        ("", False),
    ],
)
def test_is_delay_variant(title, expected):
    assert _is_delay_variant({"title": title}) is expected


# --- _status -------------------------------------------------------------------


def test_status_mapping():
    assert _status(True) is StockStatus.IN_STOCK
    assert _status(False) is StockStatus.OUT_OF_STOCK
    assert _status(None) is StockStatus.UNKNOWN


# --- parse_products: filtering -------------------------------------------------


def test_parses_single_variant_hpr_motor():
    listings = parse_products([_product()])
    assert len(listings) == 1
    l = listings[0]
    assert l.vendor_slug == "newcenturyrocketry"
    assert l.motor_designation == "I180W-14A"
    assert l.manufacturer == "AeroTech"  # the model default — matched against the AT catalog
    assert l.status is StockStatus.IN_STOCK
    assert l.price_cents == 6299  # "62.99" -> cents
    assert l.currency == "USD"
    assert l.sku == "091814"
    assert l.stock_count is None
    assert l.url == "https://newcenturyrocketry.shop/products/aerotech-rms-38-360-i180w-14a-white-lightning"
    assert "?variant=" not in l.url  # single SKU keeps the canonical product URL


def test_drops_non_aerotech_vendor():
    # Cesaroni at New Century is hardware (cases) — and a different vendor anyway.
    assert parse_products([_product(vendor="Cesaroni", title="Cesaroni 54mm 4G case")]) == []
    assert parse_products([_product(vendor="Estes", title="Estes Alpha III")]) == []


def test_drops_hardware_without_a_designation():
    # AeroTech-brand casing/closure rows carry no motor designation -> dropped.
    assert parse_products([_product(title="Aerotech RMS 38mm Forward Seal Disc, Stainless")]) == []
    assert parse_products([_product(title="Aerotech 29mm Aft Closure")]) == []


def test_drops_product_without_handle():
    assert parse_products([_product(handle="")]) == []
    assert parse_products([_product(handle=None)]) == []


def test_out_of_stock_status():
    listings = parse_products([_product(variants=[_variant(available=False)])])
    assert len(listings) == 1
    assert listings[0].status is StockStatus.OUT_OF_STOCK


def test_non_numeric_price_is_none():
    listings = parse_products([_product(variants=[_variant(price="Sold Out")])])
    assert listings[0].price_cents is None


# --- parse_products: delay-variant fan-out -------------------------------------


def test_fans_out_delay_variants_with_per_delay_availability():
    # Real shape: G76G single-use with three burn-delay variants; -4 is sold out
    # while -7 and -10 are in stock. Each delay -> its own listing/row.
    prod = _product(
        title="Aerotech RMS-29/40-120 G76G Mojave Green Model Rocket Motor Reload Kit",
        handle="aerotech-rms-29-40-120-g76g-mojave-green",
        variants=[
            _variant(id=1, title="-4", available=False, price="25.99", sku="G76G-4"),
            _variant(id=2, title="-7", available=True, price="25.99", sku="G76G-7"),
            _variant(id=3, title="-10", available=True, price="25.99", sku="G76G-10"),
        ],
    )
    listings = parse_products([prod])
    assert len(listings) == 3
    by_delay = {l.motor_designation: l for l in listings}
    # Delay folded into the designation; the matcher strips "-N" back to the catalog motor.
    assert set(by_delay) == {"G76G-4", "G76G-7", "G76G-10"}
    assert by_delay["G76G-4"].status is StockStatus.OUT_OF_STOCK
    assert by_delay["G76G-7"].status is StockStatus.IN_STOCK
    assert by_delay["G76G-10"].status is StockStatus.IN_STOCK
    assert all(l.price_cents == 2599 for l in listings)
    # Each variant keeps the ?variant= selector so (vendor, url) stays unique.
    assert by_delay["G76G-7"].url.endswith("/aerotech-rms-29-40-120-g76g-mojave-green?variant=2")


def test_default_title_lone_variant_is_not_a_delay_fanout():
    # A single "Default Title" variant must NOT be treated as a delay option.
    listings = parse_products([_product()])
    assert len(listings) == 1
    assert listings[0].motor_designation == "I180W-14A"


# --- scrape(): products.json pagination ----------------------------------------


class _JsonResp:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        return None

    def json(self):
        return self._data


class _PagedClient:
    """Serves /products.json pages keyed by ?page=N, then empties to stop."""

    def __init__(self, pages):
        self._pages = pages
        self.calls = 0

    async def get(self, url, **kwargs):
        import re

        self.calls += 1
        m = re.search(r"page=(\d+)", url)
        page = int(m.group(1)) if m else 1
        products = self._pages[page - 1] if page - 1 < len(self._pages) else []
        return _JsonResp({"products": products})


@pytest.mark.asyncio
async def test_scrape_paginates_until_empty():
    pages = [
        [_product(handle="p1", variants=[_variant(id=1)])],
        [_product(title="Aerotech H128W-14A White Lightning", handle="p2", variants=[_variant(id=2)])],
    ]
    client = _PagedClient(pages)
    listings = await NewCenturyRocketryScraper().scrape(client)
    assert {l.motor_designation for l in listings} == {"I180W-14A", "H128W-14A"}
    # Pages 1, 2 (data) then page 3 (empty) stops the walk.
    assert client.calls == 3


@pytest.mark.asyncio
async def test_scrape_honors_limit():
    pages = [[_product(handle=f"p{i}", variants=[_variant(id=i)]) for i in range(5)]]
    listings = await NewCenturyRocketryScraper().scrape(_PagedClient(pages), limit=2)
    assert len(listings) == 2
