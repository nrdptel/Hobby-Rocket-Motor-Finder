"""Async scraper for wildmanrocketry.com (Shopify storefront, IL).

Wildman carries many brands (AeroTech, Cesaroni, Loki, ...) and the product
catalog (~1900 items) spans far beyond motors. Discovery strategy:

  1. /sitemap.xml → /sitemap_products_*.xml.
  2. Filter to motor-shaped slugs: AeroTech ``[a-o]\\d…`` and Cesaroni
     ``pr\\d\\d…`` (the "pr<diameter>" handle; hardware uses "p<diameter>"
     without the r, so it's excluded) — a fast first cut.
  3. Fetch each candidate and parse the inline product blob; keep ``vendor`` ==
     ``AEROTECH`` or ``CESARONI TECHNOLOGY`` (Cesaroni products are emitted as a
     single listing keyed on commonName + flavor, with the diameter from the
     handle — see ``_cti_listings``).

Per product page:
  * Wildman does NOT publish Product JSON-LD; the canonical product info lives
    in a ``<script type="application/json">`` blob containing the full product
    (title, vendor, handle, variants[], options). Each variant exposes
    ``available``, ``inventory_quantity`` (a real number!), ``inventory_policy``,
    ``price`` (in cents), and ``sku``. This is BETTER than BRM, which hides
    inventory_quantity.
  * Status mapping:
      - available=True + inventory_quantity>0  -> IN_STOCK_WITH_COUNT
      - available=True (no count)              -> IN_STOCK
      - available=False + policy=continue      -> SPECIAL_ORDER (backorder)
      - available=False (any other policy)     -> OUT_OF_STOCK
  * For multi-variant delay products, emit one Listing per variant (same shape
    as the BRM scraper).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re

from ..http import PoliteAsyncClient
from ..models import Listing, StockStatus, _utc_now
from ..normalize import (
    extract_cti_designation,
    extract_designation,
    infer_propellant_from_title,
    propellant_letter,
)
from .base import Scraper

log = logging.getLogger(__name__)

CESARONI_MANUFACTURER = "Cesaroni Technology"  # the name ThrustCurve stores

SITEMAP_URL = "https://wildmanrocketry.com/sitemap.xml"
PRODUCTS_SITEMAP_RE = re.compile(
    r"https://wildmanrocketry\.com/sitemap_products_\d+\.xml(?:\?[^<\s\"]*)?",
)
# Motor-shaped product URL: /products/{class-letter}{digit}{...}
PRODUCT_URL_RE = re.compile(
    r"https://wildmanrocketry\.com/products/[a-o]\d[a-z0-9\-]*",
)
# Cesaroni motor products use a "pr<diameter>" handle (e.g. pr98-6gxl-i =
# Pro98 -> "O3400-CTI IMAX"). Hardware uses "p<diameter>" (no 'r': p98-rr,
# p75-sp-case), which this deliberately excludes — so the handle both finds the
# motors and yields the casing diameter for collision-breaking.
CTI_PRODUCT_URL_RE = re.compile(
    r"https://wildmanrocketry\.com/products/pr\d{2}[a-z0-9\-]*",
)
CTI_DIAMETER_RE = re.compile(r"/products/pr(\d{2})")
# Belt-and-suspenders: skip the rare hardware item that reaches the CTI branch.
CTI_HARDWARE_RE = re.compile(
    r"\b(closure|casing|case|spacer|nozzle|liner|hardware|insulator|retainer)\b",
    re.IGNORECASE,
)
INLINE_JSON_RE = re.compile(
    r'<script[^>]+type="application/json"[^>]*>(.*?)</script>',
    re.S,
)
DELAY_OPTION_RE = re.compile(r"^\s*\d{1,2}\s*$")


class WildmanScraper(Scraper):
    slug = "wildman"
    name = "Wildman Rocketry"
    homepage = "https://wildmanrocketry.com"
    state = "IL"
    # Shopify aggressively rate-limits per-product fetches from data-center
    # IPs (e.g., GitHub Actions). Hitting 4 concurrent / 200ms interval got
    # ~80% of our product pages 403'd on Azure runners. 2 concurrent / 1s
    # interval matches our conservative AMW/Sirius pace and clears the
    # threshold cleanly. Slightly slower scrape, but reliable.
    max_concurrent_per_host = 2
    min_start_interval_s = 1.0

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        if only_urls:
            urls = list(only_urls)
            log.info("wildman: scraping %d explicit URLs", len(urls))
        else:
            urls = sorted(await self._discover_product_urls(client))
            log.info("wildman: discovered %d motor-shaped product URLs", len(urls))
        if limit is not None:
            urls = urls[:limit]
            log.info("wildman: capped to %d URLs (--limit)", len(urls))

        async def _safe(url: str) -> list[Listing]:
            try:
                return await self._scrape_product(client, url)
            except Exception as e:
                log.warning("wildman: skipping %s: %s", url, e)
                return []

        results = await asyncio.gather(*[_safe(u) for u in urls])
        return [l for lst in results for l in lst]

    async def _discover_product_urls(self, client: PoliteAsyncClient) -> set[str]:
        r = await client.get(SITEMAP_URL)
        r.raise_for_status()
        product_sitemaps = sorted(set(PRODUCTS_SITEMAP_RE.findall(r.text)))
        log.info("wildman: %d product sub-sitemaps in index", len(product_sitemaps))

        async def fetch_sitemap(url: str) -> set[str]:
            try:
                r2 = await client.get(url)
                r2.raise_for_status()
                # Both AeroTech ([a-o]N…) and Cesaroni (prNN…) motor handles.
                return set(PRODUCT_URL_RE.findall(r2.text)) | set(CTI_PRODUCT_URL_RE.findall(r2.text))
            except Exception as e:
                log.warning("wildman: sub-sitemap fetch failed %s: %s", url, e)
                return set()

        results = await asyncio.gather(*[fetch_sitemap(u) for u in product_sitemaps])
        urls: set[str] = set()
        for s in results:
            urls |= s
        return urls

    async def _scrape_product(self, client: PoliteAsyncClient, url: str) -> list[Listing]:
        r = await client.get(url)
        r.raise_for_status()
        html = r.text
        product = _extract_product_blob(html)
        if product is None:
            # Not a recognized Shopify product page, or no inline blob — skip silently
            return []
        vendor = (product.get("vendor") or "").upper()
        if vendor not in ("AEROTECH", "CESARONI TECHNOLOGY"):
            return []  # other brands (Loki, etc.) out of scope

        title = product.get("title") or ""
        canonical_url = url.split("?", 1)[0]
        variants = product.get("variants") or []
        if not variants:
            return []

        if vendor == "CESARONI TECHNOLOGY":
            return self._cti_listings(title, url, canonical_url, variants)

        product_designation = extract_designation(title) or ""

        # Determine if the option is a delay (numeric variant titles like 4, 7, 10).
        options = product.get("options") or []
        first_opt_name = ""
        if options:
            first = options[0]
            if isinstance(first, dict):
                first_opt_name = (first.get("name") or "").lower()
            elif isinstance(first, str):
                first_opt_name = first.lower()
        is_delay_option = (
            "delay" in first_opt_name
            or any(_is_delay_variant(v) for v in variants)
        )

        if len(variants) == 1 or not is_delay_option:
            v = variants[0]
            return [
                _variant_to_listing(
                    vendor_slug=self.slug,
                    product_title=title,
                    canonical_url=canonical_url,
                    variant=v,
                    motor_designation=product_designation,
                    propellant_code="",  # single SKU, designation already includes propellant
                    is_single_variant=True,
                )
            ]

        # Multi-variant delay product: synthesize per-variant designations.
        propellant_name = infer_propellant_from_title(title)
        p_letter = propellant_letter(propellant_name)
        return [
            _variant_to_listing(
                vendor_slug=self.slug,
                product_title=title,
                canonical_url=canonical_url,
                variant=v,
                motor_designation=product_designation,
                propellant_code=p_letter,
                is_single_variant=False,
            )
            for v in variants
            if _is_delay_variant(v)
        ]

    def _cti_listings(
        self, title: str, url: str, canonical_url: str, variants: list
    ) -> list[Listing]:
        """Emit a single listing for a Cesaroni product.

        CTI's commonName + flavor identifies the catalog motor regardless of the
        (field-adjustable) delay, so there's no per-delay variant fan-out like
        AeroTech — we use the first variant for price/stock. The Pro-size in the
        handle gives the diameter the matcher uses to break the lone commonName+
        flavor collision.
        """
        designation = extract_cti_designation(title)
        if not designation or CTI_HARDWARE_RE.search(title):
            return []
        return [
            _variant_to_listing(
                vendor_slug=self.slug,
                product_title=title,
                canonical_url=canonical_url,
                variant=variants[0],
                motor_designation=designation,
                propellant_code="",
                is_single_variant=True,
                manufacturer=CESARONI_MANUFACTURER,
                diameter_mm=_cti_diameter_from_url(url),
            )
        ]


def _cti_diameter_from_url(url: str) -> int | None:
    m = CTI_DIAMETER_RE.search(url)
    return int(m.group(1)) if m else None


def _extract_product_blob(html: str) -> dict | None:
    """Find the inline ``<script type="application/json">`` blob that contains
    the full product (it has both ``vendor`` and ``variants``).
    """
    for s in INLINE_JSON_RE.findall(html):
        text = s.strip()
        if not text.startswith("{"):
            continue
        if '"vendor"' not in text or '"variants"' not in text:
            continue
        try:
            d = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(d, dict) and "vendor" in d and "variants" in d:
            return d
    return None


def _is_delay_variant(variant: dict) -> bool:
    title = str(variant.get("title") or "")
    if title.lower() == "default title":
        return False
    return bool(DELAY_OPTION_RE.match(title))


def _variant_to_listing(
    *,
    vendor_slug: str,
    product_title: str,
    canonical_url: str,
    variant: dict,
    motor_designation: str,
    propellant_code: str,
    is_single_variant: bool,
    manufacturer: str = "AeroTech",
    diameter_mm: int | None = None,
) -> Listing:
    delay = str(variant.get("title") or "").strip()
    sku_field = variant.get("sku")
    sku = str(sku_field) if sku_field else None
    variant_id = variant.get("id")

    price_raw = variant.get("price")
    price_cents: int | None
    if isinstance(price_raw, (int, float)):
        price_cents = int(round(float(price_raw)))
    else:
        price_cents = None

    available = variant.get("available")
    inv_qty = variant.get("inventory_quantity")
    inv_policy = (variant.get("inventory_policy") or "").lower()

    if available is True:
        if isinstance(inv_qty, int) and inv_qty > 0:
            status = StockStatus.IN_STOCK_WITH_COUNT
            stock_count = inv_qty
        else:
            status = StockStatus.IN_STOCK
            stock_count = None
    elif available is False:
        status = (
            StockStatus.SPECIAL_ORDER if inv_policy == "continue" else StockStatus.OUT_OF_STOCK
        )
        stock_count = None
    else:
        status = StockStatus.UNKNOWN
        stock_count = None

    if is_single_variant:
        synthetic = motor_designation
        variant_url = canonical_url
    else:
        if motor_designation and delay:
            synthetic = f"{motor_designation}-{delay}{propellant_code}"
        else:
            synthetic = motor_designation or ""
        variant_url = f"{canonical_url}?variant={variant_id}" if variant_id else canonical_url

    return Listing(
        vendor_slug=vendor_slug,
        motor_designation=synthetic,
        motor_id=None,
        url=variant_url,
        sku=sku,
        price_cents=price_cents,
        currency="USD",
        status=status,
        stock_count=stock_count,
        raw_title=product_title,
        manufacturer=manufacturer,
        diameter_mm=diameter_mm,
        seen_at=_utc_now(),
    )
