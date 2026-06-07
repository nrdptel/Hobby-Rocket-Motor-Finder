"""Async scraper for BuyRocketMotors.com (Shopify storefront, TX).

Discovery:
  * Paginate Shopify's auth-free ``/products.json?limit=250&page=N`` endpoint
    to get every product with its vendor and title. Filter to ``vendor ==
    AEROTECH`` and titles that contain a recognizable motor designation.
  * This catches motors under non-standard URL prefixes that a regex over
    the sitemap would miss: ``enerjet-by-aerotech-...``, ``aerotech-economax-...``,
    ``pre-order-only-aerotech-...``, etc.

Per product page:
  * Parse Product JSON-LD for default-variant name, sku, price, availability.
  * Also extract the inline Shopify variants array (from a
    ``<script type="application/json">`` blob that lists every variant with
    its own ``available``, ``price``, ``sku``, and option title).
  * For products with multiple variants where the option is a delay (e.g.,
    Aerotech D13 with values 4/7/10 seconds), emit one Listing per variant.
    Each variant's ``url`` includes the Shopify ``?variant={id}`` selector
    so the (vendor, url) UNIQUE constraint stores them as distinct rows.
  * Synthesize a vendor designation by combining the canonical motor class
    + digits + variant delay + propellant letter inferred from the title
    (e.g., "D13" + "4" + "W" -> "D13-4W"), so the Variety column matches the
    naming users see at single-SKU vendors like csrocketry.

Politeness: Shopify on Cloudflare/Fastly handles 4 concurrent connections at
0.2s start cadence comfortably; same defaults as csrocketry.
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

PRODUCTS_JSON_URL = "https://www.buyrocketmotors.com/products.json"
PRODUCT_BASE_URL = "https://www.buyrocketmotors.com/products/"
JSON_LD_RE = re.compile(
    r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
    re.S,
)
INLINE_JSON_RE = re.compile(
    r'<script[^>]+type="application/json"[^>]*>(.*?)</script>',
    re.S,
)
# How we tell a variant option is a delay-time selector.
DELAY_OPTION_RE = re.compile(r"^\s*\d{1,2}\s*$")


class BuyRocketMotorsScraper(Scraper):
    slug = "buyrocketmotors"
    name = "BuyRocketMotors.com"
    homepage = "https://www.buyrocketmotors.com"
    state = "TX"
    # Shopify aggressively rate-limits per-product fetches from data-center
    # IPs. See the same comment in wildman.py — 2 concurrent / 1s interval
    # is the threshold below which we don't get 403'd from GH Actions.
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
            log.info("buyrocketmotors: scraping %d explicit URLs", len(urls))
        else:
            urls = sorted(await self._discover_product_urls(client))
            log.info("buyrocketmotors: discovered %d AeroTech product URLs", len(urls))
        if limit is not None:
            urls = urls[:limit]
            log.info("buyrocketmotors: capped to %d URLs (--limit)", len(urls))

        async def _safe(url: str) -> list[Listing]:
            try:
                return await self._scrape_product(client, url)
            except Exception as e:
                log.warning("buyrocketmotors: skipping %s: %s", url, e)
                return []

        result_lists = await asyncio.gather(*[_safe(u) for u in urls])
        return [l for lst in result_lists for l in lst]

    async def _discover_product_urls(self, client: PoliteAsyncClient) -> set[str]:
        """Walk /products.json pages, keep vendor==AEROTECH with a motor-shaped
        title. Returns canonical product URLs."""
        urls: set[str] = set()
        page = 1
        SAFETY_MAX_PAGES = 20
        while page <= SAFETY_MAX_PAGES:
            r = await client.get(f"{PRODUCTS_JSON_URL}?limit=250&page={page}")
            r.raise_for_status()
            products = r.json().get("products", [])
            if not products:
                break
            for p in products:
                if (p.get("vendor") or "").upper() != "AEROTECH":
                    continue
                title = p.get("title") or ""
                # Use the same designation regex that the matcher uses.
                if extract_designation(title) is None:
                    continue
                handle = p.get("handle")
                if handle:
                    urls.add(f"{PRODUCT_BASE_URL}{handle}")
            log.info(
                "buyrocketmotors: products.json page %d had %d products (%d AEROTECH motors total so far)",
                page, len(products), len(urls),
            )
            page += 1
        return urls

    async def _scrape_product(self, client: PoliteAsyncClient, url: str) -> list[Listing]:
        r = await client.get(url)
        r.raise_for_status()
        html = r.text
        product = _extract_product_jsonld(html)
        if product is None:
            raise ValueError("no Product JSON-LD block")

        offers = product.get("offers") or {}
        if isinstance(offers, list):
            offers = offers[0] if offers else {}

        name = product.get("name") or ""
        currency = str(offers.get("priceCurrency") or "USD")
        canonical_url = str(offers.get("url") or url).split("?", 1)[0]
        product_designation = extract_designation(name) or ""

        variants = _extract_variants(html)
        if variants:
            delay_variants = [v for v in variants if _is_delay_variant(v)]
            if len(delay_variants) >= 1 and len(variants) > 1:
                # Multi-variant product where each variant is a delay option.
                # Emit one Listing per variant.
                propellant_name = infer_propellant_from_title(name)
                p_letter = propellant_letter(propellant_name)
                return [
                    _variant_to_listing(self.slug, name, canonical_url, v, product_designation, p_letter, currency)
                    for v in delay_variants
                ]

        # Single-variant product (HPR motor, kit, etc.) — use default-variant data
        # from the Product JSON-LD.
        availability = (offers.get("availability") or "").lower()
        price_cents = _to_cents(offers.get("price"))
        sku = str(product.get("sku") or offers.get("sku") or "") or None
        return [
            Listing(
                vendor_slug=self.slug,
                motor_designation=product_designation,
                motor_id=None,
                url=str(offers.get("url") or url),
                sku=sku,
                price_cents=price_cents,
                currency=currency,
                status=_availability_to_status(availability),
                stock_count=None,
                raw_title=name,
                seen_at=_utc_now(),
            )
        ]


def _extract_product_jsonld(html: str) -> dict | None:
    for block in JSON_LD_RE.findall(html):
        try:
            data = json.loads(block, strict=False)
        except json.JSONDecodeError:
            continue
        items = data if isinstance(data, list) else [data]
        if isinstance(data, dict) and "@graph" in data:
            items = data["@graph"]
        for item in items:
            if isinstance(item, dict) and item.get("@type") == "Product":
                return item
    return None


def _extract_variants(html: str) -> list[dict] | None:
    """Find the inline Shopify variants array — the one that includes the
    ``available`` boolean per variant (the JSON-LD only has the default).

    Shopify themes embed this as a top-level array inside a
    ``<script type="application/json">`` tag near the product form.
    """
    for m in INLINE_JSON_RE.finditer(html):
        text = m.group(1).strip()
        if not text.startswith("["):
            continue
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            continue
        if not isinstance(data, list) or not data:
            continue
        first = data[0]
        if (
            isinstance(first, dict)
            and "sku" in first
            and "available" in first
            and "title" in first
        ):
            return data
    return None


def _is_delay_variant(variant: dict) -> bool:
    """True if the variant's title looks like a delay-seconds value."""
    title = str(variant.get("title") or "")
    if title.lower() == "default title":
        return False
    return bool(DELAY_OPTION_RE.match(title))


def _variant_to_listing(
    vendor_slug: str,
    product_title: str,
    canonical_url: str,
    variant: dict,
    product_designation: str,
    propellant_code: str,
    currency: str,
) -> Listing:
    delay = str(variant.get("title") or "").strip()
    variant_id = variant.get("id")
    sku_field = variant.get("sku")
    sku = str(sku_field) if sku_field else None
    price_value = variant.get("price")
    # Shopify inline JSON encodes price as cents (e.g. 2100 for $21.00).
    price_cents: int | None
    if isinstance(price_value, (int, float)):
        price_cents = int(round(float(price_value)))
    else:
        price_cents = None
    available = variant.get("available")
    inventory_policy = (variant.get("inventory_policy") or "").lower()
    if available is True:
        status = StockStatus.IN_STOCK
    elif available is False:
        status = (
            StockStatus.SPECIAL_ORDER if inventory_policy == "continue" else StockStatus.OUT_OF_STOCK
        )
    else:
        status = StockStatus.UNKNOWN
    # Synthesize a vendor SKU like "D13-4W" combining motor base + delay + propellant.
    if product_designation and delay:
        synthetic = f"{product_designation}-{delay}{propellant_code}"
    else:
        synthetic = product_designation or ""
    variant_url = f"{canonical_url}?variant={variant_id}" if variant_id else canonical_url
    return Listing(
        vendor_slug=vendor_slug,
        motor_designation=synthetic,
        motor_id=None,
        url=variant_url,
        sku=sku,
        price_cents=price_cents,
        currency=currency,
        status=status,
        stock_count=None,
        raw_title=product_title,
        seen_at=_utc_now(),
    )


def _availability_to_status(availability: str) -> StockStatus:
    a = (availability or "").lower()
    if "instock" in a:
        return StockStatus.IN_STOCK
    if "outofstock" in a:
        return StockStatus.OUT_OF_STOCK
    if "preorder" in a or "backorder" in a:
        return StockStatus.SPECIAL_ORDER
    return StockStatus.UNKNOWN


def _to_cents(price) -> int | None:
    if price is None:
        return None
    try:
        return int(round(float(price) * 100))
    except (TypeError, ValueError):
        return None
