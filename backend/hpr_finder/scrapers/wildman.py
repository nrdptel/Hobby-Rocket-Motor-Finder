"""Async scraper for wildmanrocketry.com (Shopify storefront, IL).

Wildman carries many brands (AeroTech, Cesaroni, Loki, ...) and the product
catalog (~1900 items) spans far beyond motors. Discovery strategy:

  1. /sitemap.xml → /sitemap_products_*.xml.
  2. Filter to motor-shaped slugs (``[a-o]\\d[a-z0-9\\-]*``) — fast first cut.
  3. Fetch each candidate and parse the inline product blob; keep only those
     with ``vendor`` == ``AEROTECH``.

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
    extract_designation,
    infer_propellant_from_title,
    propellant_letter,
)
from .base import Scraper

log = logging.getLogger(__name__)

SITEMAP_URL = "https://wildmanrocketry.com/sitemap.xml"
PRODUCTS_SITEMAP_RE = re.compile(
    r"https://wildmanrocketry\.com/sitemap_products_\d+\.xml(?:\?[^<\s\"]*)?",
)
# Motor-shaped product URL: /products/{class-letter}{digit}{...}
PRODUCT_URL_RE = re.compile(
    r"https://wildmanrocketry\.com/products/[a-o]\d[a-z0-9\-]*",
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
    max_concurrent_per_host = 4
    min_start_interval_s = 0.2

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
                return set(PRODUCT_URL_RE.findall(r2.text))
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
        if (product.get("vendor") or "").upper() != "AEROTECH":
            return []  # non-AeroTech product (Cesaroni, Loki, etc.)

        title = product.get("title") or ""
        canonical_url = url.split("?", 1)[0]
        product_designation = extract_designation(title) or ""
        variants = product.get("variants") or []
        if not variants:
            return []

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
        seen_at=_utc_now(),
    )
