"""Async scraper for Performance Hobbies (performancehobbies.com, VA).

Performance Hobbies is the only vendor in our directory carrying all three
covered manufacturers — AeroTech, Cesaroni (CTI), and Loki — so it's a single
scraper that deepens coverage on every brand at once.

The store is a custom ASP.NET app (``/secure/store.aspx?groupid=<id>``). Unlike
the Shopify vendors there's no sitemap or JSON feed, and unlike Loki there's no
single catalog page either: products live in a *tree* of group pages
(brand -> category -> diameter -> product leaf). There are NO per-product detail
pages — each leaf group page renders its products inline as ``<tr>`` rows in a
``<table border=2>``. So discovery is a recursive walk of the group tree starting
from the three brand roots, and parsing is a row scan on every page.

Per-row signals:
  * ``<a name='PRODUCT NAME'>`` — present on EVERY product row (in-stock and
    out-of-stock alike), so it's the only stable cross-status id. We build the
    listing URL from it (``<group_url>#<name>`` — the anchor really exists on the
    page) and use it as the raw title for designation/flavor extraction.
  * a ``$N,NNN.NN`` price.
  * stock: an ``action=addtocart&productid=<id>`` link means in stock (the
    productid is ONLY present then, so we never key on it); literal "Out of stock"
    means out of stock; "Call for ..." means special order. The store never shows
    a unit count, so there's no ``in_stock_with_count`` here.

Designations reuse the existing per-manufacturer extractors — PH lists AeroTech
with clean designations (``J570W-14A``), Cesaroni in the standard
``<flavor> <n> grain <impulse><class><thrust>-<delay>A`` form
(``White Thunder 4 grain 540-I470-15A`` -> commonName I470 + flavor), and Loki by
common name (``K350 White Reload``). Cesaroni diameter (the matcher's
collision-breaker) comes from the ``ProNN`` group name, threaded down the walk.

Encoding note: the server sends ``charset=utf-8`` but emits invalid bytes
(stray Windows-1252 control codes in product descriptions). We decode the raw
body as latin-1 — a lossless byte->char mapping that never raises — because every
token we parse (tags, prices, designations) is ASCII.
"""
from __future__ import annotations

import re
from urllib.parse import quote

from ..http import PoliteAsyncClient
from ..models import Listing, StockStatus, _utc_now
from ..normalize import (
    extract_cti_designation,
    extract_designation,
    extract_loki_designation,
)
from .base import Scraper
from .prices import price_to_cents

BASE_URL = "https://performancehobbies.com"
GROUP_URL = f"{BASE_URL}/secure/store.aspx?groupid="

# The three brand roots we walk, each tagged with the manufacturer name
# ThrustCurve stores (so listings route to the right catalog in find_motor_id)
# and the extractor that turns a PH product name into a catalog designation.
AEROTECH = "AeroTech"
CESARONI = "Cesaroni Technology"
LOKI = "Loki Research"
ROOTS: tuple[tuple[str, str], ...] = (
    ("2180210303839", AEROTECH),
    ("32902113543318", CESARONI),
    ("105200411244039", LOKI),
)
_EXTRACTORS = {
    AEROTECH: extract_designation,
    CESARONI: extract_cti_designation,
    LOKI: extract_loki_designation,
}

# Group ids of the global nav menu (Home/Motors/Electronics/Recovery/Kits/...).
# They appear as ``but_*`` image links on EVERY page; never recurse into them or
# the walk would escape the brand subtree and wander the whole store.
NAV_GROUP_IDS = frozenset(
    {
        "21402114301241",  # Motors (top)
        "312201212580820",  # Electronics
        "21402114305831",  # Recovery
        "21402114255540",  # Rocket Kits
        "21402114310527",  # Accessories
        "8420141121578",  # Gift Certificates
    }
)

# Subgroups whose NAME marks them as not-a-motor (hardware/accessories) or a
# manufacturer outside our scope (AMW, Kosdon both live under the AeroTech /
# Cesaroni roots). Pruning them keeps the unmatched bucket clean and the walk
# small; motor leaves never match these words.
_SKIP_NAME_RE = re.compile(
    r"hardware|delay\s*kit|hybrid|\bamw\b|kosdon|spacer|closure|\bseal\b|"
    r"\btool\b|casing|\bcase\b|starter|igniter|electric\s*match|accessor|grain",
    re.I,
)

# Content subgroup links are always list items: <li><a href="store.aspx?groupid=N">NAME</a>.
# Breadcrumb/parent links use a bare <a> (no <li>), so keying on <li> excludes them.
_SUBGROUP_RE = re.compile(
    r"<li>\s*<a\s+href=\"store\.aspx\?groupid=(\d+)\"[^>]*>(.*?)</a>", re.S | re.I
)
_TR_RE = re.compile(r"<tr\b.*?</tr>", re.S | re.I)
_ANCHOR_RE = re.compile(r"<a\s+name='([^']*)'", re.I)
_PRICE_RE = re.compile(r"\$([\d,]+\.\d{2})")
_PRODUCTID_RE = re.compile(r"action=addtocart&productid=(\d+)", re.I)
_TAG_RE = re.compile(r"<[^>]+>")
# Diameter from a group name: "Pro38 Reload Kits" -> 38, "54MM Motors" -> 54.
_DIAMETER_RE = re.compile(r"pro\s*(\d{2,3})|(\d{2,3})\s*mm", re.I)


class PerformanceHobbiesScraper(Scraper):
    slug = "performancehobbies"
    name = "Performance Hobbies"
    homepage = BASE_URL
    state = "VA"
    # Small ASP store on a single host — be gentle, like Loki.
    max_concurrent_per_host = 2
    min_start_interval_s = 1.0

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        listings: list[Listing] = []
        for root_id, manufacturer in ROOTS:
            await _crawl(client, root_id, manufacturer, None, set(), listings, limit)
            if limit is not None and len(listings) >= limit:
                break
        # There are no per-product pages to fetch directly, so ``only_urls`` can't
        # skip discovery the way it does for sitemap vendors; honor it by filtering
        # the walk's results to the requested URLs (mirrors Loki's stance).
        if only_urls:
            wanted = set(only_urls)
            listings = [l for l in listings if l.url in wanted]
        if limit is not None:
            listings = listings[:limit]
        return listings


async def _crawl(
    client: PoliteAsyncClient,
    group_id: str,
    manufacturer: str,
    diameter_mm: int | None,
    visited: set[str],
    out: list[Listing],
    limit: int | None,
) -> None:
    """Depth-first walk of one group subtree, appending product listings to ``out``.

    ``diameter_mm`` is inherited from the nearest ancestor whose name encoded a
    Pro-size / NNmm, and used (for Cesaroni) to disambiguate the matcher.
    """
    if group_id in visited or group_id in NAV_GROUP_IDS:
        return
    visited.add(group_id)
    if limit is not None and len(out) >= limit:
        return
    url = GROUP_URL + group_id
    r = await client.get(url)
    r.raise_for_status()
    # See module docstring: decode bytes as latin-1, never r.text (mis-declared utf-8).
    html = r.content.decode("latin-1")
    out.extend(parse_products(html, url, manufacturer, diameter_mm))
    for sub_id, sub_name in extract_subgroups(html):
        if sub_id in visited or sub_id in NAV_GROUP_IDS or _SKIP_NAME_RE.search(sub_name):
            continue
        child_diameter = parse_diameter(sub_name) or diameter_mm
        await _crawl(client, sub_id, manufacturer, child_diameter, visited, out, limit)
        if limit is not None and len(out) >= limit:
            return


def extract_subgroups(html: str) -> list[tuple[str, str]]:
    """Return ``(group_id, name)`` for each content subgroup link on the page."""
    return [
        (gid, _cell_text(raw)) for gid, raw in _SUBGROUP_RE.findall(html)
    ]


def parse_diameter(name: str) -> int | None:
    """Diameter (mm) encoded in a group name, e.g. ``Pro38`` / ``54mm`` -> 38 / 54."""
    m = _DIAMETER_RE.search(name)
    if not m:
        return None
    return int(m.group(1) or m.group(2))


def parse_products(
    html: str, group_url: str, manufacturer: str, diameter_mm: int | None
) -> list[Listing]:
    """Parse one group page's product rows into Listings. Pure (no network).

    Rows without a recognizable motor designation (hardware/accessories that
    slipped past the name filter) are skipped rather than emitted as unmatched.
    """
    extract = _EXTRACTORS[manufacturer]
    seen_at = _utc_now()
    out: list[Listing] = []
    for row in _TR_RE.findall(html):
        anchor = _ANCHOR_RE.search(row)
        if not anchor:
            continue
        name = _unescape(anchor.group(1)).strip()
        price_cents = _price_cents(row)
        productid_match = _PRODUCTID_RE.search(row)
        # A real product row has a price and/or an add-to-cart link; anything
        # else (stray anchors) isn't a purchasable item.
        if price_cents is None and productid_match is None:
            continue
        designation = extract(name)
        if not designation:
            continue
        out.append(
            Listing(
                vendor_slug="performancehobbies",
                motor_designation=designation,
                motor_id=None,
                url=f"{group_url}#{quote(name)}",
                sku=productid_match.group(1) if productid_match else None,
                price_cents=price_cents,
                currency="USD",
                status=_classify_status(row, productid_match is not None),
                stock_count=None,  # PH never publishes unit counts
                raw_title=name,
                manufacturer=manufacturer,
                diameter_mm=diameter_mm,
                seen_at=seen_at,
            )
        )
    return out


def _classify_status(row: str, in_stock: bool) -> StockStatus:
    if in_stock:
        return StockStatus.IN_STOCK
    if re.search(r"out of stock", row, re.I):
        return StockStatus.OUT_OF_STOCK
    if re.search(r"call for", row, re.I):
        return StockStatus.SPECIAL_ORDER
    return StockStatus.UNKNOWN


def _price_cents(row: str) -> int | None:
    m = _PRICE_RE.search(row)
    if not m:
        return None
    return price_to_cents(m.group(1))


def _cell_text(html: str) -> str:
    return re.sub(r"\s+", " ", _TAG_RE.sub(" ", html)).strip()


def _unescape(text: str) -> str:
    # Anchor names are plain text but may carry a stray &amp;; keep it light.
    return text.replace("&amp;", "&")
