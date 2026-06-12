"""Async scraper for Chris' Rocket Supplies (csrocketry.com).

Discovery:
  1. /sitemap.xml.gz   → product URLs matching the relaxed regex
  2. Each sub-category page (anything in sitemap that isn't a product) →
     additional product URLs (catches what csrocketry forgot to add to sitemap)

Per product page:
  * Parse the Product JSON-LD block for name, sku, price, availability.
    Lenient JSON-LD parser tolerates ill-formed ``\\'`` escapes.
  * Extract "Stock Level: N" div for the numeric in-stock count.

All fetches go through PoliteAsyncClient, so discovery and product scraping
both happen concurrently within the politeness budget (concurrency + start
rate) — no manual orchestration needed.
"""
from __future__ import annotations

import asyncio
import gzip
import json
import logging
import re

from ..http import PoliteAsyncClient
from ..models import Listing, StockStatus, _utc_now
from ..normalize import extract_cti_designation, extract_designation
from .base import Scraper
from .prices import price_to_cents

log = logging.getLogger(__name__)

CESARONI_MANUFACTURER = "Cesaroni Technology"  # the name ThrustCurve stores

SITEMAP_URL = "https://www.csrocketry.com/sitemap.xml.gz"
PRODUCT_URL_RE = re.compile(
    r"https://www\.csrocketry\.com/rocket-motors/aerotech-rocketry/motors/"
    r"[^<\s\"]+/(?:aerotech-|[a-o]\d)[^<\s\"]*\.html",
    re.IGNORECASE,
)
# Cesaroni product pages live under /rocket-motors/cesaroni/motors/<pro-size>/...
# and their leaf slug always begins "cesaroni-" (e.g. cesaroni-i170-14a-classic-
# rocket-motor.html). Category pages (…/pro-38.html, …-reloads.html) lack that
# leaf, so this only matches real products.
CTI_PRODUCT_URL_RE = re.compile(
    r"https://www\.csrocketry\.com/rocket-motors/cesaroni/motors/"
    r"[^<\s\"]+/cesaroni-[a-z0-9-]+\.html",
    re.IGNORECASE,
)
CTI_ANY_HTML_RE = re.compile(
    r"https://www\.csrocketry\.com/rocket-motors/cesaroni/motors/[^<\s\"]+\.html",
    re.IGNORECASE,
)
CATEGORY_URL_SUFFIXES = (
    "-reloads.html",
    "-rocket-motors.html",
    "-replacement.html",
    "-delay-kits.html",
    "-by-aerotech.html",
    "/motors.html",
    "/single-use.html",
)
DIAMETER_IN_URL_RE = re.compile(r"/motors/(\d+)mm[/-]")
# Cesaroni encodes the casing diameter as the Pro-size in the path: /pro-38/ = 38mm.
PRO_SIZE_RE = re.compile(r"/pro-(\d+)\b", re.IGNORECASE)
ACCESSORY_TAIL_RE = re.compile(r"/aerotech-universal-delay-tool\.html$", re.I)
JSON_LD_RE = re.compile(
    r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
    re.S,
)
STOCK_LEVEL_RE = re.compile(r"Stock Level:\s*(\d+)")
OOS_TEXT_RE = re.compile(r"currently out of stock", re.I)


class CSRocketryScraper(Scraper):
    slug = "csrocketry"
    name = "Chris' Rocket Supplies"
    homepage = "https://www.csrocketry.com"
    state = "GA"
    # Measured 2026-05-23: csrocketry handles 4 concurrent + 0.2s start cadence
    # (~5 req/s) cleanly with no 429s or 5xx errors. Full ~300-page scrape
    # finishes in ~2 minutes.
    max_concurrent_per_host = 4
    min_start_interval_s = 0.2

    min_diameter_mm: int = 0  # 29 = HPR-only

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        if only_urls:
            urls = list(only_urls)
            log.info("csrocketry: scraping %d explicit URLs (skipping discovery)", len(urls))
        else:
            urls = sorted(await self._discover_product_urls(client))
            log.info("csrocketry: discovered %d motor product URLs (AeroTech + Cesaroni)", len(urls))
            if self.min_diameter_mm > 0:
                before = len(urls)
                urls = [u for u in urls if _diameter_at_least(u, self.min_diameter_mm)]
                log.info(
                    "csrocketry: filtered to %d URLs with diameter >= %dmm (was %d)",
                    len(urls), self.min_diameter_mm, before,
                )
        if limit is not None:
            urls = urls[:limit]
            log.info("csrocketry: capped to %d URLs (--limit)", len(urls))

        async def _safe(url: str) -> Listing | None:
            try:
                return await self._scrape_product(client, url)
            except Exception as e:
                log.warning("csrocketry: skipping %s: %s", url, e)
                return None

        results = await asyncio.gather(*[_safe(u) for u in urls])
        return [r for r in results if r is not None]

    async def _discover_product_urls(self, client: PoliteAsyncClient) -> set[str]:
        """Two-stage discovery: sitemap (1 request) + concurrent sub-category crawl.

        Covers both the AeroTech and Cesaroni motor trees — they share the same
        sitemap and page structure, and ``_scrape_product`` tells them apart by URL.
        """
        text = await self._sitemap_text(client)
        urls = self._extract_product_urls(text) | self._extract_cti_product_urls(text)
        log.info("csrocketry: %d product URLs from sitemap", len(urls))
        subcat_urls = self._extract_subcategory_urls(text) | self._extract_cti_subcategory_urls(text)
        log.info("csrocketry: crawling %d sub-category pages", len(subcat_urls))

        async def fetch_subcat(subcat: str) -> set[str]:
            try:
                r = await client.get(subcat)
                r.raise_for_status()
                return self._extract_product_urls(r.text) | self._extract_cti_product_urls(r.text)
            except Exception as e:
                log.warning("csrocketry: subcat fetch failed %s: %s", subcat, e)
                return set()

        extras: list[set[str]] = await asyncio.gather(*[fetch_subcat(s) for s in subcat_urls])
        before = len(urls)
        for s in extras:
            urls |= s
        log.info("csrocketry: subcat crawl added %d extra products (total %d)", len(urls) - before, len(urls))
        return urls

    async def _sitemap_text(self, client: PoliteAsyncClient) -> str:
        r = await client.get(SITEMAP_URL)
        r.raise_for_status()
        raw = r.content
        try:
            return gzip.decompress(raw).decode("utf-8", errors="replace")
        except OSError:
            return raw.decode("utf-8", errors="replace")

    @staticmethod
    def _extract_product_urls(text: str) -> set[str]:
        urls = set(PRODUCT_URL_RE.findall(text))
        return {
            u for u in urls
            if not u.endswith(CATEGORY_URL_SUFFIXES)
            and not ACCESSORY_TAIL_RE.search(u)
        }

    @staticmethod
    def _extract_subcategory_urls(text: str) -> set[str]:
        """All .html URLs under /motors/ that don't look like product pages."""
        all_html = set(re.findall(
            r"https://www\.csrocketry\.com/rocket-motors/aerotech-rocketry/motors/[^<\s\"]+\.html",
            text,
        ))
        product_urls = set(PRODUCT_URL_RE.findall(text))
        return all_html - product_urls

    @staticmethod
    def _extract_cti_product_urls(text: str) -> set[str]:
        return set(CTI_PRODUCT_URL_RE.findall(text))

    @staticmethod
    def _extract_cti_subcategory_urls(text: str) -> set[str]:
        """Cesaroni .html URLs under /cesaroni/motors/ that aren't product pages."""
        return set(CTI_ANY_HTML_RE.findall(text)) - set(CTI_PRODUCT_URL_RE.findall(text))

    async def _scrape_product(self, client: PoliteAsyncClient, url: str) -> Listing:
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
        sku = str(product.get("sku") or offers.get("sku") or "") or None
        availability = offers.get("availability") or ""
        price = offers.get("price")
        price_cents = price_to_cents(price)

        # Cesaroni and AeroTech products share this page layout; the URL tree tells
        # them apart, and each brand needs its own designation extractor + match
        # manufacturer. Cesaroni also carries a diameter hint (the Pro-size).
        is_cti = "/cesaroni/" in url.lower()
        if is_cti:
            designation = extract_cti_designation(name) or ""
            manufacturer = CESARONI_MANUFACTURER
            diameter_mm = _pro_size_diameter(url)
        else:
            designation = extract_designation(name) or ""
            manufacturer = "AeroTech"
            diameter_mm = None

        stock_count: int | None = None
        m = STOCK_LEVEL_RE.search(html)
        if m:
            stock_count = int(m.group(1))

        status = _availability_to_status(availability, stock_count, html)

        return Listing(
            vendor_slug=self.slug,
            motor_designation=designation,
            motor_id=None,
            url=offers.get("url") or url,
            sku=sku,
            price_cents=price_cents,
            currency=str(offers.get("priceCurrency") or "USD"),
            status=status,
            stock_count=stock_count,
            raw_title=name,
            manufacturer=manufacturer,
            diameter_mm=diameter_mm,
            seen_at=_utc_now(),
        )


def _pro_size_diameter(url: str) -> int | None:
    """Casing diameter (mm) from a Cesaroni Pro-size URL, e.g. /pro-38/ -> 38."""
    m = PRO_SIZE_RE.search(url)
    return int(m.group(1)) if m else None


def _diameter_at_least(url: str, min_mm: int) -> bool:
    # AeroTech URLs carry "/NNmm/"; Cesaroni URLs carry "/pro-NN/".
    m = DIAMETER_IN_URL_RE.search(url)
    diameter = int(m.group(1)) if m else _pro_size_diameter(url)
    if diameter is None:
        return False
    return diameter >= min_mm


_INVALID_JSON_ESCAPE_RE = re.compile(r'\\(?!["\\/bfnrtu])')


def _parse_jsonld_block(block: str):
    """Parse a JSON-LD block, tolerating common ill-formed escapes.

    csrocketry's Product JSON-LD sometimes embeds ``\\'`` inside descriptions
    (e.g. "AeroTech's first 6-inch motor") — that's not a valid JSON escape.
    We retry after stripping leading backslashes that don't precede a valid
    JSON escape character.
    """
    try:
        return json.loads(block, strict=False)
    except json.JSONDecodeError:
        cleaned = _INVALID_JSON_ESCAPE_RE.sub("", block)
        try:
            return json.loads(cleaned, strict=False)
        except json.JSONDecodeError:
            return None


def _extract_product_jsonld(html: str) -> dict | None:
    for block in JSON_LD_RE.findall(html):
        data = _parse_jsonld_block(block)
        if data is None:
            continue
        items = data if isinstance(data, list) else [data]
        if isinstance(data, dict) and "@graph" in data:
            items = data["@graph"]
        for item in items:
            if isinstance(item, dict) and item.get("@type") == "Product":
                return item
    return None


def _availability_to_status(availability: str, stock_count: int | None, html: str) -> StockStatus:
    a = (availability or "").lower()
    if "instock" in a:
        if stock_count is not None:
            # A parsed count of 0 is sold out, not in-stock-with-count-zero —
            # matches the n>0 guards in amw/balsa/moto_joe.
            return StockStatus.IN_STOCK_WITH_COUNT if stock_count > 0 else StockStatus.OUT_OF_STOCK
        return StockStatus.IN_STOCK
    if "outofstock" in a or OOS_TEXT_RE.search(html):
        return StockStatus.OUT_OF_STOCK
    return StockStatus.UNKNOWN
