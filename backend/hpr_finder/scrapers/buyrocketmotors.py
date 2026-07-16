"""Async scraper for BuyRocketMotors.com (Shopify storefront, TX).

Discovery + data, both from Shopify's auth-free ``/products.json?limit=250&page=N``:
  * Paginate it to get every product with its ``vendor``, ``handle``, ``title``,
    ``options`` and full ``variants`` array. Filter to ``vendor == AEROTECH`` and
    titles that contain a recognizable motor designation.
  * This catches motors under non-standard URL prefixes a sitemap regex would
    miss: ``enerjet-by-aerotech-...``, ``aerotech-economax-...``,
    ``pre-order-only-aerotech-...``, etc.

This replaced an older approach that used products.json only for DISCOVERY and
then fetched each product PAGE to read its inline variants. Shopify/Cloudflare
rate-limits (403s) that many per-product requests from data-center IPs (GitHub
Actions), leaving the scrape below floor and the data carried-forward/stale.
products.json already carries every variant's ``available``/``price``/``sku``/
``title`` in ~3 paginated requests, so we read them straight from it — no
per-product fetch. The only fidelity cost is that products.json omits
``inventory_policy``, so a backorder reads OUT_OF_STOCK rather than
SPECIAL_ORDER. No LISTINGS are lost (BRM publishes only in/out-of-stock today).

Per product:
  * For products with multiple variants where the option is a delay (e.g.,
    Aerotech D13 with values 4/7/10 seconds), emit one Listing per variant.
    Each variant's ``url`` includes the Shopify ``?variant={id}`` selector
    so the (vendor, url) UNIQUE constraint stores them as distinct rows.
  * Synthesize a vendor designation by combining the canonical motor class
    + digits + variant delay + propellant letter inferred from the title
    (e.g., "D13" + "4" + "W" -> "D13-4W"), so the Variety column matches the
    naming users see at single-SKU vendors like csrocketry.
"""
from __future__ import annotations

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
from .prices import price_to_cents

log = logging.getLogger(__name__)

PRODUCTS_JSON_URL = "https://www.buyrocketmotors.com/products.json"
PRODUCT_BASE_URL = "https://www.buyrocketmotors.com/products/"
# How we tell a variant option is a delay-time selector.
DELAY_OPTION_RE = re.compile(r"^\s*\d{1,2}\s*$")
SAFETY_MAX_PAGES = 20


class BuyRocketMotorsScraper(Scraper):
    slug = "buyrocketmotors"
    name = "BuyRocketMotors.com"
    homepage = "https://www.buyrocketmotors.com"
    state = "TX"
    # Only a few products.json page fetches now, so the conservative
    # per-product-fetch pace is no longer needed; keep it polite regardless.
    max_concurrent_per_host = 2
    min_start_interval_s = 0.5
    use_proxy = True  # Shopify/Cloudflare 429s the CI data-center IP; go via proxy.

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        products = await self._discover_products(client)
        if only_urls:
            wanted = {_handle_of(u) for u in only_urls}
            products = [p for p in products if p.get("handle") in wanted]
            log.info("buyrocketmotors: filtered to %d products from %d explicit URLs",
                     len(products), len(only_urls))
        else:
            log.info("buyrocketmotors: %d AeroTech motor products from products.json", len(products))
        if limit is not None:
            products = products[:limit]
            log.info("buyrocketmotors: capped to %d products (--limit)", len(products))

        listings: list[Listing] = []
        for p in products:
            try:
                listings.extend(self._product_to_listings(p))
            except Exception as e:
                log.warning("buyrocketmotors: skipping %s: %s", p.get("handle"), e)
        return listings

    async def _discover_products(self, client: PoliteAsyncClient) -> list[dict]:
        """Walk /products.json pages, keep vendor==AEROTECH with a motor-shaped
        title. Variant prices (dollar strings) are normalized to integer cents in
        place so the shared variant→listing logic is unchanged."""
        out: list[dict] = []
        page = 1
        while page <= SAFETY_MAX_PAGES:
            r = await client.get(f"{PRODUCTS_JSON_URL}?limit=250&page={page}")
            r.raise_for_status()
            products = r.json().get("products", [])
            if not products:
                break
            for p in products:
                if (p.get("vendor") or "").upper() != "AEROTECH":
                    continue
                if extract_designation(p.get("title") or "") is None:
                    continue
                for v in p.get("variants") or []:
                    v["price"] = price_to_cents(v.get("price"))
                out.append(p)
            log.info(
                "buyrocketmotors: products.json page %d had %d products (%d AEROTECH motors total so far)",
                page, len(products), len(out),
            )
            page += 1
        return out

    def _product_to_listings(self, product: dict) -> list[Listing]:
        name = product.get("title") or ""
        handle = product.get("handle") or ""
        canonical_url = f"{PRODUCT_BASE_URL}{handle}"
        product_designation = extract_designation(name) or ""
        variants = product.get("variants") or []
        if not variants:
            return []

        delay_variants = [v for v in variants if _is_delay_variant(v)]
        if len(delay_variants) >= 1 and len(variants) > 1:
            # Multi-variant product where each variant is a delay option.
            # Emit one Listing per variant.
            propellant_name = infer_propellant_from_title(name)
            p_letter = propellant_letter(propellant_name)
            return [
                _variant_to_listing(self.slug, name, canonical_url, v, product_designation, p_letter, "USD")
                for v in delay_variants
            ]

        # Single-variant product (HPR motor, kit, etc.) — use the default variant.
        v0 = variants[0]
        sku_field = v0.get("sku")
        sku = str(sku_field) if sku_field else None
        available = v0.get("available")
        if available is True:
            status = StockStatus.IN_STOCK
        elif available is False:
            status = StockStatus.OUT_OF_STOCK
        else:
            status = StockStatus.UNKNOWN
        price_raw = v0.get("price")
        price_cents = int(round(float(price_raw))) if isinstance(price_raw, (int, float)) else None
        # Keep the ``?variant={id}`` suffix the old JSON-LD-sourced URL carried, so
        # the (vendor, url) listing key is byte-stable across this scraper rewrite
        # (no history churn / orphaned rows). Default variant id == variants[0].id.
        variant_id = v0.get("id")
        url = f"{canonical_url}?variant={variant_id}" if variant_id else canonical_url
        return [
            Listing(
                vendor_slug=self.slug,
                motor_designation=product_designation,
                motor_id=None,
                url=url,
                sku=sku,
                price_cents=price_cents,
                currency="USD",
                status=status,
                stock_count=None,
                raw_title=name,
                seen_at=_utc_now(),
            )
        ]


def _handle_of(url: str) -> str:
    """Product handle from a full product URL (for --url smoke testing)."""
    return url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1]


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
    # variant['price'] was normalized to integer cents in _discover_products.
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
