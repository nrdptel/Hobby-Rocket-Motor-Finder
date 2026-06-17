"""Tests for pack-size resolution (backend/hpr_finder/pack.py).

URL parsing mirrors frontend/lib/pack.ts; the consensus + price-band inference is
the backend-only piece that fills in vendors who don't encode the pack size in
their URL (e.g. AeroTech-direct, CSRocketry, Moto-Joe for the D24 3-pack).
"""
from __future__ import annotations

from hpr_finder.pack import pack_size_from_url, resolve_pack_sizes

# --- URL parsing ------------------------------------------------------------

def test_url_pack_digit_forms():
    assert pack_size_from_url("https://v/aerotech-d24-rms-18-20-3-pack") == 3
    assert pack_size_from_url("https://v/c3-4t-12-pack-1849.html") == 12
    assert pack_size_from_url("https://v/e15-pw-3pk") == 3
    assert pack_size_from_url("https://v/e24c-2-motor-pack-52407") == 2
    # URL-encoded "#D24-4T 3 Pack"
    assert pack_size_from_url("https://v/store.aspx?groupid=72#D24-4T%203%20Pack") == 3


def test_url_pack_word_forms():
    assert pack_size_from_url("https://v/aerotech-three-pack-x") == 3
    assert pack_size_from_url("https://v/store#E20-4W%20%28two%20pack%29") == 2


def test_url_no_pack_is_single():
    assert pack_size_from_url("https://v/aerotech-h128w-rms-29-180") == 1
    assert pack_size_from_url("https://v/k750st-ps-reload-kit-1-pack") == 1  # explicit single
    assert pack_size_from_url("") == 1
    assert pack_size_from_url(None) == 1
    # A big number in the URL isn't a 24+ pack of motors.
    assert pack_size_from_url("https://v/n4000r-rms-98-20480") == 1
    assert pack_size_from_url("https://v/weird-99-pack") == 1


# --- consensus + price band -------------------------------------------------

def _l(vendor, url, price):
    return {"vendor_slug": vendor, "url": url, "price_cents": price}


def _motor(listings):
    return {"motors": [{"designation": "D24T", "listings": listings}]}


def test_consensus_fills_url_less_stragglers():
    """The real D24T case: 3 vendors encode 3-pack in their URL; AeroTech-direct,
    CSRocketry, and Moto-Joe don't, but their prices sit in the 3-pack range, so
    they're inferred as 3-packs too."""
    snap = _motor([
        _l("sirius", "https://s/d24-4t-reload-kit-3-pack-1707.html", 2435),
        _l("performancehobbies", "https://p/store.aspx#D24-4T%203%20Pack", 2799),
        _l("buyrocketmotors", "https://b/aerotech-d24-rms-18-20-3-pack", 2239),
        _l("aerotechdirect", "https://a/products/product_6e085b0b", 2799),
        _l("csrocketry", "https://c/aerotech-d24-4t-blue-thunder-rocket-motor.html", 2799),
        _l("moto_joe", "https://m/index.php?product_id=166", 1900),
    ])
    resolve_pack_sizes(snap)
    sizes = {l["vendor_slug"]: l["pack_size"] for l in snap["motors"][0]["listings"]}
    assert sizes == {
        "sirius": 3,
        "performancehobbies": 3,
        "buyrocketmotors": 3,
        "aerotechdirect": 3,
        "csrocketry": 3,
        "moto_joe": 3,
    }


def test_single_priced_listing_is_not_divided():
    """A genuine single priced ~1/3 of the pack total stays a single — its price
    is below the band, so consensus never divides it."""
    snap = _motor([
        _l("sirius", "https://s/d24-3-pack", 2400),
        _l("buyrocketmotors", "https://b/d24-3-pack", 2400),
        _l("somesingle", "https://x/d24-single", 800),  # ~1/3 → a real single
    ])
    resolve_pack_sizes(snap)
    sizes = {l["vendor_slug"]: l["pack_size"] for l in snap["motors"][0]["listings"]}
    assert sizes["somesingle"] == 1
    assert sizes["sirius"] == 3 and sizes["buyrocketmotors"] == 3


def test_no_inference_without_two_vendor_agreement():
    """A single vendor claiming a pack size isn't enough to infer for others."""
    snap = _motor([
        _l("sirius", "https://s/d24-3-pack", 2400),
        _l("csrocketry", "https://c/d24-plain", 2400),
    ])
    resolve_pack_sizes(snap)
    sizes = {l["vendor_slug"]: l["pack_size"] for l in snap["motors"][0]["listings"]}
    assert sizes == {"sirius": 3, "csrocketry": 1}


def test_conflicting_pack_sizes_block_inference():
    """If two vendors say 3-pack and two say 2-pack, there's no single consensus,
    so nothing is inferred for url-less listings."""
    snap = _motor([
        _l("a", "https://a/x-3-pack", 2400),
        _l("b", "https://b/x-3-pack", 2400),
        _l("c", "https://c/x-2-pack", 1600),
        _l("d", "https://d/x-2-pack", 1600),
        _l("e", "https://e/x-plain", 2400),
    ])
    resolve_pack_sizes(snap)
    sizes = {l["vendor_slug"]: l["pack_size"] for l in snap["motors"][0]["listings"]}
    assert sizes["e"] == 1  # ambiguous — left alone


def test_null_priced_straggler_left_alone():
    """A listing with no price can't be band-checked, so it stays a single."""
    snap = _motor([
        _l("sirius", "https://s/d24-3-pack", 2400),
        _l("buyrocketmotors", "https://b/d24-3-pack", 2400),
        _l("noprice", "https://x/d24-plain", None),
    ])
    resolve_pack_sizes(snap)
    sizes = {l["vendor_slug"]: l["pack_size"] for l in snap["motors"][0]["listings"]}
    assert sizes["noprice"] == 1


def test_explicit_url_size_kept_even_outside_consensus():
    """A listing whose URL says 2-pack keeps 2 even when the motor's consensus is
    3 — explicit per-listing data wins."""
    snap = _motor([
        _l("a", "https://a/x-3-pack", 2400),
        _l("b", "https://b/x-3-pack", 2400),
        _l("c", "https://c/x-2-pack", 1600),
    ])
    resolve_pack_sizes(snap)
    sizes = {l["vendor_slug"]: l["pack_size"] for l in snap["motors"][0]["listings"]}
    assert sizes["c"] == 2
