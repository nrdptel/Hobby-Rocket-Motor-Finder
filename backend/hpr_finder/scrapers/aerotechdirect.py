"""Async scraper for AeroTech / Quest manufacturer-direct (aerotech-rocketry.com, UT).

This is the canonical, manufacturer-direct source for AeroTech — the brand we
otherwise only see through resellers. It's a Shopify store, so discovery is the
clean ``products.json`` endpoint (paginated), and designations come straight out
of the product titles (``AeroTech J550ST-14 54mm RMS Reload Kit``).

The catch — and the reason this scraper is special — is that AeroTech does NOT
expose a usable real-time stock signal. Their Shopify backorders nearly
everything (314/316 motors report ``available: true`` while real fulfillment runs
6–44 weeks out), and ``inventory_quantity`` / ``inventory_policy`` are hidden. So
``available`` here means "you can order it," not "it's on the shelf." Marking
those as ``in_stock`` would be actively misleading on the brand's own store.

What AeroTech *does* publish honestly is a homepage banner with per-category
fulfillment lead times. So while that banner is up we treat every orderable motor
as ``special_order`` and annotate it with the lead-time tier parsed live from the
banner (kept fresh: we read the actual week ranges, not hardcoded numbers):

  * "A"–"G" type motors                      -> short tier  (e.g. 6–8 weeks)
  * 29–38mm RMS reloads & DMS motors         -> mid tier    (e.g. 16–20 weeks)
  * 54–152mm RMS reloads & DMS motors        -> long tier   (e.g. 40–44 weeks)

Self-healing: if the banner is ever gone (fulfillment returned to normal), we log
a warning and fall back to normal Shopify semantics (``available`` -> in stock),
since the premise for the special-order treatment no longer holds.
"""
from __future__ import annotations

import logging
import re

from ..http import PoliteAsyncClient
from ..models import Listing, StockStatus, _utc_now
from ..normalize import extract_designation
from .base import Scraper

log = logging.getLogger(__name__)

BASE_URL = "https://aerotech-rocketry.com"
PRODUCTS_URL = f"{BASE_URL}/products.json"
MANUFACTURER = "AeroTech"
_PAGE_SIZE = 250
_MAX_PAGES = 20  # safety stop; the catalog is ~3 pages

# Banner parsing. The marker tells us the special fulfillment regime is active;
# each tier line pairs a category phrase with an "X to Y weeks" range.
_BANNER_MARKER_RE = re.compile(r"temporary fulfillment times", re.I)
_AG_RE = re.compile(r"a\s*type\s*to\s*g\s*type.{0,80}?(\d+)\s*to\s*(\d+)\s*weeks", re.I | re.S)
_SMALL_RE = re.compile(r"29-38\s*mm.{0,80}?(\d+)\s*to\s*(\d+)\s*weeks", re.I | re.S)
_LARGE_RE = re.compile(r"54-152\s*mm.{0,80}?(\d+)\s*to\s*(\d+)\s*weeks", re.I | re.S)
_TAG_RE = re.compile(r"<[^>]+>")
# Diameter from a motor title: "75mm", "RMS-38/720", "RMS-98/20480".
_DIAMETER_MM_RE = re.compile(r"(\d{2,3})\s*mm", re.I)
_DIAMETER_RMS_RE = re.compile(r"RMS-(\d{2,3})", re.I)
# Titles that are accessories/hardware/merch, not motors — skip even if a stray
# token looks designation-ish. (extract_designation already rejects most.)
_NON_MOTOR_RE = re.compile(
    r"hardware|casing|closure|forward seal|aft seal|seal disk|spacer|"
    r"delay (?:kit|tool)|liner|o-ring|grain|nozzle|lanyard|sticker|shirt|"
    r"\bcap\b|\bhat\b|igniter|starter",
    re.I,
)
# Out-of-scope brands sold on the AeroTech/Quest store. Quest Q-Jet / MicroMaxx
# are a different manufacturer (not in our catalog), so they'd only land in the
# unmatched bucket — skip them to keep this an AeroTech-only feed. See
# [[project-manufacturer-scope-locked]].
_SKIP_BRAND_RE = re.compile(r"\bquest\b|q-?jet|micro\s*maxx", re.I)


class LeadTimes:
    """The three motor fulfillment tiers parsed from the banner, each a display
    string like ``"16–20 weeks"`` (or None if that tier's range wasn't found)."""

    __slots__ = ("ag", "small", "large")

    def __init__(self, ag: str | None, small: str | None, large: str | None) -> None:
        self.ag, self.small, self.large = ag, small, large

    def for_motor(self, designation: str, title: str) -> str | None:
        """Lead-time tier for a motor by impulse class (A–G short tier) else by
        diameter (≤38mm mid tier, ≥54mm long tier). None if it can't be placed."""
        cls = designation[:1].upper()
        if cls in "ABCDEFG":
            return self.ag
        diameter = parse_diameter(title)
        if diameter is None:
            return None  # don't guess a tier for an H+ motor of unknown size
        return self.small if diameter <= 38 else self.large


class AeroTechDirectScraper(Scraper):
    slug = "aerotechdirect"
    name = "AeroTech (direct)"
    homepage = BASE_URL
    state = "UT"
    # Shopify host; modest pagination. Be gentle.
    max_concurrent_per_host = 2
    min_start_interval_s = 0.5

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        # 1) Read the homepage banner to learn the fulfillment regime + tiers.
        home = await client.get(BASE_URL)
        home.raise_for_status()
        tiers = parse_lead_times(home.text)
        backorder_mode = tiers is not None
        if not backorder_mode:
            log.warning(
                "aerotechdirect: fulfillment banner not found — AeroTech may have "
                "returned to normal; treating 'available' as real stock. Revisit "
                "this scraper's special-order assumption."
            )

        # 2) Walk the Shopify products feed.
        listings: list[Listing] = []
        for page in range(1, _MAX_PAGES + 1):
            r = await client.get(PRODUCTS_URL, params={"limit": _PAGE_SIZE, "page": page})
            r.raise_for_status()
            products = r.json().get("products", [])
            if not products:
                break
            listings.extend(parse_products(products, tiers, backorder_mode))
            if limit is not None and len(listings) >= limit:
                break

        if only_urls:
            wanted = set(only_urls)
            listings = [l for l in listings if l.url in wanted]
        if limit is not None:
            listings = listings[:limit]
        return listings


def parse_lead_times(html: str) -> LeadTimes | None:
    """Parse the fulfillment banner into motor lead-time tiers, or None if the
    banner (the ``temporary fulfillment times`` marker) isn't present. Pure."""
    text = _TAG_RE.sub(" ", html)
    text = re.sub(r"[“”‘’\"']", "", text)  # drop smart/plain quotes
    text = re.sub(r"\s+", " ", text)
    if not _BANNER_MARKER_RE.search(text):
        return None
    return LeadTimes(
        ag=_weeks(_AG_RE, text),
        small=_weeks(_SMALL_RE, text),
        large=_weeks(_LARGE_RE, text),
    )


def _weeks(pattern: re.Pattern[str], text: str) -> str | None:
    m = pattern.search(text)
    return f"{m.group(1)}–{m.group(2)} weeks" if m else None


def parse_diameter(title: str) -> int | None:
    """Motor diameter (mm) from a title: ``75mm`` or ``RMS-38/...`` -> 75 / 38."""
    m = _DIAMETER_MM_RE.search(title) or _DIAMETER_RMS_RE.search(title)
    return int(m.group(1)) if m else None


def parse_products(
    products: list[dict], tiers: LeadTimes | None, backorder_mode: bool
) -> list[Listing]:
    """Turn raw Shopify product dicts into motor Listings. Pure (no network).

    Non-motor products (hardware, accessories, merch) and anything without a
    recognizable AeroTech designation are skipped.
    """
    seen_at = _utc_now()
    out: list[Listing] = []
    for p in products:
        title = p.get("title") or ""
        if _NON_MOTOR_RE.search(title) or _SKIP_BRAND_RE.search(title):
            continue
        designation = extract_designation(title)
        if not designation:
            continue
        variants = p.get("variants") or []
        available = any(v.get("available") for v in variants)
        price_cents = _first_price_cents(variants)
        sku = next((v.get("sku") for v in variants if v.get("sku")), None)
        handle = p.get("handle") or ""

        if not available:
            status, lead_time = StockStatus.OUT_OF_STOCK, None
        elif backorder_mode:
            # Orderable, but everything is backordered while the banner is up.
            status = StockStatus.SPECIAL_ORDER
            lead_time = tiers.for_motor(designation, title) if tiers else None
        else:
            # Banner gone: trust availability as real stock again.
            status, lead_time = StockStatus.IN_STOCK, None

        out.append(
            Listing(
                vendor_slug="aerotechdirect",
                motor_designation=designation,
                motor_id=None,
                url=f"{BASE_URL}/products/{handle}",
                sku=sku,
                price_cents=price_cents,
                currency="USD",
                status=status,
                stock_count=None,
                raw_title=title,
                manufacturer=MANUFACTURER,
                lead_time=lead_time,
                seen_at=seen_at,
            )
        )
    return out


def _first_price_cents(variants: list[dict]) -> int | None:
    for v in variants:
        price = v.get("price")
        if price is None:
            continue
        try:
            return int(round(float(price) * 100))
        except (TypeError, ValueError):
            continue
    return None
