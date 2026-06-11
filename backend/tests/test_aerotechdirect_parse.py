"""Parse-level tests for the AeroTech-direct scraper.

AeroTech-direct is a Shopify store that backorders nearly everything, so the
scraper treats orderable motors as special_order and annotates them with a
fulfillment lead-time tier parsed live from the homepage banner. Fixtures: the
real banner region and a trimmed products.json (one A–G motor, a 38mm and a 75mm
reload, an unavailable reload, plus a hardware set and a lanyard that must be
skipped), captured 2026-06.
"""
import json
from pathlib import Path

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.aerotechdirect import (
    LeadTimes,
    parse_diameter,
    parse_lead_times,
    parse_products,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _banner() -> str:
    return (FIXTURES / "aerotechdirect_home_banner.html").read_text(encoding="utf-8")


def _products() -> list[dict]:
    return json.loads((FIXTURES / "aerotechdirect_products.json").read_text())["products"]


def _by(listings, frag):
    return next(l for l in listings if frag in l.motor_designation)


# --- banner parsing ----------------------------------------------------------

def test_parse_lead_times_reads_tiers_from_banner():
    t = parse_lead_times(_banner())
    assert t is not None
    assert t.ag == "6–8 weeks"
    assert t.small == "16–20 weeks"
    assert t.large == "40–44 weeks"


def test_parse_lead_times_none_without_marker():
    # Self-healing hook: no banner -> no special fulfillment regime.
    assert parse_lead_times("<html><body>Welcome to the store</body></html>") is None


# --- tier mapping + diameter -------------------------------------------------

def test_lead_time_tier_mapping():
    t = LeadTimes("6–8 weeks", "16–20 weeks", "40–44 weeks")
    assert t.for_motor("F115SN-12A", "29mm DMS Rocket Motor") == "6–8 weeks"  # A–G by class
    assert t.for_motor("J510W-14A", "RMS-38/1320 Reload Kit") == "16–20 weeks"  # H+ 38mm
    assert t.for_motor("N2700W-PS", "75mm RMS Reload Kit") == "40–44 weeks"  # H+ 75mm
    assert t.for_motor("M1850W", "no diameter in here") is None  # H+ unknown size


def test_parse_diameter():
    assert parse_diameter("AeroTech N2700W-PS 75mm RMS Reload Kit") == 75
    assert parse_diameter("AeroTech N4000W-PS RMS-98/20480 Reload Kit") == 98
    assert parse_diameter("AeroTech something with no size") is None


# --- products parsing --------------------------------------------------------

def test_backorder_mode_special_order_with_lead_times():
    listings = parse_products(_products(), parse_lead_times(_banner()), backorder_mode=True)
    # Hardware set + lanyard dropped; four motors remain.
    assert len(listings) == 4
    assert all(l.manufacturer == "AeroTech" for l in listings)
    assert all(l.vendor_slug == "aerotechdirect" for l in listings)

    ag = _by(listings, "F115SN-12A")
    assert ag.status == StockStatus.SPECIAL_ORDER
    assert ag.lead_time == "6–8 weeks"
    assert ag.price_cents is not None
    assert ag.url.startswith("https://aerotech-rocketry.com/products/")

    assert _by(listings, "N2700W-PS").lead_time == "40–44 weeks"
    assert _by(listings, "J510W-14A").lead_time == "16–20 weeks"

    oos = _by(listings, "I364FJ-14A")  # variant unavailable
    assert oos.status == StockStatus.OUT_OF_STOCK
    assert oos.lead_time is None


def test_self_heals_to_normal_stock_when_banner_gone():
    # Banner absent -> trust availability as real stock; no lead-time annotation.
    listings = parse_products(_products(), None, backorder_mode=False)
    instock = _by(listings, "F115SN-12A")
    assert instock.status == StockStatus.IN_STOCK
    assert instock.lead_time is None
    assert _by(listings, "I364FJ-14A").status == StockStatus.OUT_OF_STOCK


def test_non_motor_and_out_of_scope_products_skipped():
    titles = " ".join(l.raw_title for l in parse_products(_products(), None, backorder_mode=False))
    assert "Hardware Set" not in titles  # hardware
    assert "Lanyard" not in titles  # merch
    # Quest Q-Jet is a different manufacturer (out of scope) sold on the same store.
    assert "Quest" not in titles and "Q-Jet" not in titles


def test_price_comes_from_available_variant():
    # The sold-out variant is listed first; the in-stock motor must show the
    # available variant's price, not the sold-out one's.
    products = [
        {
            "title": "AeroTech H128W-14A",
            "handle": "h128w",
            "variants": [
                {"available": False, "price": "9.99", "sku": "OLD"},
                {"available": True, "price": "21.50", "sku": "NEW"},
            ],
        }
    ]
    listings = parse_products(products, None, backorder_mode=False)

    assert len(listings) == 1
    l = listings[0]
    assert l.status is StockStatus.IN_STOCK
    assert l.price_cents == 2150
