"""Async scraper for wildmanrocketry.com (Shopify storefront, IL).

Wildman carries many brands (AeroTech, Cesaroni, Loki, ...) and the product
catalog (~1900 items) spans far beyond motors. Discovery strategy:

  * Paginate Shopify's auth-free ``/products.json?limit=250&page=N`` endpoint,
    which returns every product with its ``vendor``, ``handle``, ``title``,
    ``options`` and full ``variants`` array in a HANDFUL of requests.
  * Keep motor-shaped handles: AeroTech ``[a-o]\\d…`` and Cesaroni ``pr\\d\\d…``
    (the "pr<diameter>" handle; hardware uses "p<diameter>" without the r, so
    it's excluded — and the diameter feeds CTI collision-breaking).
  * Keep ``vendor`` == ``AEROTECH`` or ``CESARONI TECHNOLOGY`` (Cesaroni products
    are emitted as a single listing keyed on commonName + flavor, with the
    diameter from the handle — see ``_cti_listings``).

This replaced an older sitemap-walk that fetched each of ~1900 product PAGES
individually. Shopify/Cloudflare aggressively rate-limits (403s) that many
per-product requests from data-center IPs (GitHub Actions), which left the
scrape below floor and the data carried-forward/stale. ``products.json`` carries
the same product+variant data in ~10 paginated requests, well under the block
threshold. The only fidelity cost: ``products.json`` omits ``inventory_quantity``
and ``inventory_policy``, so an in-stock variant reads IN_STOCK rather than
IN_STOCK_WITH_COUNT (no exact count), and we can't distinguish a backorder
(SPECIAL_ORDER) from out-of-stock. No LISTINGS are lost — every variant, price,
SKU and in/out-of-stock state is preserved.

Per variant (unchanged from before):
  * ``available``/``price``/``sku``/``title`` drive the listing. Status mapping:
      - available=True  -> IN_STOCK
      - available=False -> OUT_OF_STOCK
  * For multi-variant delay products, emit one Listing per variant (same shape
    as the BRM scraper).
"""
from __future__ import annotations

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
from .prices import price_to_cents

log = logging.getLogger(__name__)

CESARONI_MANUFACTURER = "Cesaroni Technology"  # the name ThrustCurve stores

PRODUCTS_JSON_URL = "https://wildmanrocketry.com/products.json"
PRODUCT_BASE_URL = "https://wildmanrocketry.com/products/"
# Motor-shaped product handle: {class-letter}{digit}{...}.
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
DELAY_OPTION_RE = re.compile(r"^\s*\d{1,2}\s*$")
SAFETY_MAX_PAGES = 60  # ~15k products at 250/page — far above the real catalog


class WildmanScraper(Scraper):
    slug = "wildman"
    name = "Wildman Rocketry"
    homepage = "https://wildmanrocketry.com"
    state = "IL"
    # products.json is a handful of requests, so the per-product-fetch rate
    # limiting that forced the conservative pace no longer applies. Keep a polite
    # default; there are only ~10 page fetches.
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
            log.info("wildman: filtered to %d products from %d explicit URLs", len(products), len(only_urls))
        else:
            log.info("wildman: %d motor-shaped products from products.json", len(products))
        if limit is not None:
            products = products[:limit]
            log.info("wildman: capped to %d products (--limit)", len(products))

        listings: list[Listing] = []
        for p in products:
            try:
                listings.extend(self._product_to_listings(p))
            except Exception as e:
                log.warning("wildman: skipping %s: %s", p.get("handle"), e)
        return listings

    async def _discover_products(self, client: PoliteAsyncClient) -> list[dict]:
        """Paginate /products.json and keep motor-shaped products. Variant prices
        (dollar strings in products.json) are normalized to integer cents in place
        so the shared variant→listing logic is unchanged."""
        out: list[dict] = []
        page = 1
        while page <= SAFETY_MAX_PAGES:
            r = await client.get(f"{PRODUCTS_JSON_URL}?limit=250&page={page}")
            r.raise_for_status()
            products = r.json().get("products", [])
            if not products:
                break
            for p in products:
                handle = p.get("handle") or ""
                url = f"{PRODUCT_BASE_URL}{handle}"
                if not (PRODUCT_URL_RE.match(url) or CTI_PRODUCT_URL_RE.match(url)):
                    continue
                for v in p.get("variants") or []:
                    v["price"] = price_to_cents(v.get("price"))
                out.append(p)
            log.info("wildman: products.json page %d had %d products (%d motor-shaped so far)",
                     page, len(products), len(out))
            page += 1
        return out

    def _product_to_listings(self, product: dict) -> list[Listing]:
        vendor = (product.get("vendor") or "").upper()
        if vendor not in ("AEROTECH", "CESARONI TECHNOLOGY"):
            return []  # other brands (Loki, etc.) out of scope

        title = product.get("title") or ""
        handle = product.get("handle") or ""
        url = f"{PRODUCT_BASE_URL}{handle}"
        canonical_url = url
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
        if not variants:
            return []
        # Use an in-stock variant when one exists, so status + price reflect a
        # buyable option rather than a sold-out variants[0]. All of a CTI product's
        # (field-adjustable) delay variants map to the same catalog motor, so any
        # available one is a valid representative.
        variant = next((v for v in variants if v.get("available") is True), variants[0])
        return [
            _variant_to_listing(
                vendor_slug=self.slug,
                product_title=title,
                canonical_url=canonical_url,
                variant=variant,
                motor_designation=designation,
                propellant_code="",
                is_single_variant=True,
                manufacturer=CESARONI_MANUFACTURER,
                diameter_mm=_cti_diameter_from_url(url),
            )
        ]


def _handle_of(url: str) -> str:
    """Product handle from a full product URL (for --url smoke testing)."""
    return url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1]


def _cti_diameter_from_url(url: str) -> int | None:
    m = CTI_DIAMETER_RE.search(url)
    return int(m.group(1)) if m else None


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
