"""Async scraper for New Century Rocketry (newcenturyrocketry.shop, SC).

A Shopify storefront. Unlike buyrocketmotors/wildman, there is nothing to gain
from fetching per-product pages: Shopify's auth-free
``/products.json?limit=250&page=N`` already carries everything we need — the
``vendor`` (brand), the ``title`` (with the motor designation), and per-variant
``available`` + ``price``. So the whole scrape is a short paginated JSON walk
(~3 requests), which is also the politest option.

Filtering:
  * Keep ``vendor == AeroTech``. The store also stocks Estes/Quest/LOC/Semroc
    kits (out of scope) and a pile of *Cesaroni hardware* — cases, closures,
    spacers, starter kits — but **no Cesaroni or Loki motors**. None of those
    carry an AeroTech-style designation, so :func:`extract_designation` returns
    None and they drop out (same mechanism the other Shopify vendors rely on to
    shed casings). If New Century ever lists actual CTI motors, this scraper
    would need a Cesaroni branch; today there are none.

Variants:
  * Most motors are a single SKU. Some low/mid-power single-use and reload
    motors expose the burn delay as Shopify variants whose titles are the delay
    seconds, written hyphen-led ("-4", "-7", "-10"). The price is identical
    across delays, but availability is NOT (e.g. G76G: -4 out, -7/-10 in), so we
    emit one Listing per delay variant — mirroring buyrocketmotors — folding the
    delay into the designation (``G76G`` -> ``G76G-7``; the matcher strips the
    ``-7`` back to the catalog designation) and tagging the URL with the Shopify
    ``?variant=`` selector so the ``(vendor, url)`` UNIQUE rows stay distinct.

products.json carries no ``inventory_policy``, so stock is a plain in/out
boolean (no special-order / backorder signal) and no quantity — same shape as
buyrocketmotors.

Politeness: only a few products.json GETs, but keep the same gentle cadence the
other Shopify vendors use to stay under Shopify's data-center-IP rate limit.
"""
from __future__ import annotations

import logging
import re

from ..http import PoliteAsyncClient
from ..models import Listing, StockStatus, _utc_now
from ..normalize import extract_designation
from .base import Scraper
from .prices import price_to_cents

log = logging.getLogger(__name__)

BASE_URL = "https://newcenturyrocketry.shop"
PRODUCTS_JSON_URL = f"{BASE_URL}/products.json"
PRODUCT_BASE_URL = f"{BASE_URL}/products/"
SAFETY_MAX_PAGES = 20
# A variant title that is a bare delay-seconds value, optionally hyphen-led as
# New Century writes them ("-4", "-7", "-10"). "Default Title" is the lone
# variant of a single-SKU product and must NOT be treated as a delay option.
DELAY_OPTION_RE = re.compile(r"^\s*-?\s*\d{1,2}\s*$")


class NewCenturyRocketryScraper(Scraper):
    slug = "newcenturyrocketry"
    name = "New Century Rocketry"
    homepage = BASE_URL
    state = "SC"
    # Shopify behind Cloudflare aggressively rate-limits data-center IPs; match
    # the conservative cadence the other Shopify vendors use from GH Actions.
    max_concurrent_per_host = 2
    min_start_interval_s = 1.0

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        # The whole catalog comes from the paginated products.json; there are no
        # per-product pages to walk, so ``only_urls`` is irrelevant and ignored.
        products: list[dict] = []
        page = 1
        while page <= SAFETY_MAX_PAGES:
            r = await client.get(f"{PRODUCTS_JSON_URL}?limit=250&page={page}")
            r.raise_for_status()
            batch = r.json().get("products", [])
            if not batch:
                break
            products.extend(batch)
            log.info(
                "newcenturyrocketry: products.json page %d had %d products (%d total)",
                page, len(batch), len(products),
            )
            page += 1
        listings = parse_products(products)
        log.info("newcenturyrocketry: parsed %d AeroTech motor listings", len(listings))
        if limit is not None:
            listings = listings[:limit]
        return listings


def parse_products(products: list[dict]) -> list[Listing]:
    """Turn a list of Shopify ``products.json`` product dicts into Listings.

    Pure (no network) so it's exercised directly by the parse tests.
    """
    seen_at = _utc_now()
    out: list[Listing] = []
    for p in products:
        if (p.get("vendor") or "").strip().lower() != "aerotech":
            continue
        title = p.get("title") or ""
        designation = extract_designation(title)
        if not designation:
            continue  # hardware (casings, seal discs, closures) — not a motor
        handle = p.get("handle")
        if not handle:
            continue
        product_url = f"{PRODUCT_BASE_URL}{handle}"
        variants = p.get("variants") or []
        delay_variants = [v for v in variants if _is_delay_variant(v)]
        if len(variants) > 1 and delay_variants:
            # Fan out: one Listing per delay option (availability differs per delay).
            out.extend(
                _variant_to_listing(designation, title, product_url, v, seen_at)
                for v in delay_variants
            )
        else:
            # Single SKU (one delay, HPR adjustable, or a kit): the lone variant
            # carries the price/stock; keep the product designation as-is.
            variant = variants[0] if variants else {}
            out.append(_to_listing(designation, title, product_url, variant, seen_at))
    return out


def _is_delay_variant(variant: dict) -> bool:
    """True if the variant title looks like a delay-seconds option ("-7", "10")."""
    title = str(variant.get("title") or "")
    if title.strip().lower() == "default title":
        return False
    return bool(DELAY_OPTION_RE.match(title))


def _status(available: object) -> StockStatus:
    # products.json gives only a boolean; no inventory_policy → no special-order
    # signal, so it's a plain in/out (or unknown if the field is absent).
    if available is True:
        return StockStatus.IN_STOCK
    if available is False:
        return StockStatus.OUT_OF_STOCK
    return StockStatus.UNKNOWN


def _to_listing(
    designation: str, title: str, url: str, variant: dict, seen_at
) -> Listing:
    sku = variant.get("sku")
    return Listing(
        vendor_slug="newcenturyrocketry",
        motor_designation=designation,
        motor_id=None,
        url=url,
        sku=str(sku) if sku else None,
        price_cents=price_to_cents(variant.get("price")),  # products.json price is a $ string
        currency="USD",
        status=_status(variant.get("available")),
        stock_count=None,
        raw_title=title,
        seen_at=seen_at,
    )


def _variant_to_listing(
    designation: str, title: str, product_url: str, variant: dict, seen_at
) -> Listing:
    delay = re.sub(r"\D", "", str(variant.get("title") or ""))  # "-7" -> "7"
    synthetic = f"{designation}-{delay}" if delay else designation
    variant_id = variant.get("id")
    url = f"{product_url}?variant={variant_id}" if variant_id else product_url
    return _to_listing(synthetic, title, url, variant, seen_at)
