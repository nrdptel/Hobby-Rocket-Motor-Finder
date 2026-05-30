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
from datetime import datetime

from ..http import PoliteAsyncClient
from ..models import Listing, StockStatus
from ..normalize import extract_designation
from .base import Scraper

log = logging.getLogger(__name__)

SITEMAP_URL = "https://www.csrocketry.com/sitemap.xml.gz"
PRODUCT_URL_RE = re.compile(
    r"https://www\.csrocketry\.com/rocket-motors/aerotech-rocketry/motors/"
    r"[^<\s\"]+/(?:aerotech-|[a-o]\d)[^<\s\"]*\.html",
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
            log.info("csrocketry: discovered %d AeroTech motor product URLs", len(urls))
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
        """Two-stage discovery: sitemap (1 request) + concurrent sub-category crawl."""
        text = await self._sitemap_text(client)
        urls = self._extract_product_urls(text)
        log.info("csrocketry: %d product URLs from sitemap", len(urls))
        subcat_urls = self._extract_subcategory_urls(text)
        log.info("csrocketry: crawling %d sub-category pages", len(subcat_urls))

        async def fetch_subcat(subcat: str) -> set[str]:
            try:
                r = await client.get(subcat)
                r.raise_for_status()
                return self._extract_product_urls(r.text)
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
        designation = extract_designation(name) or ""
        availability = offers.get("availability") or ""
        price = offers.get("price")
        price_cents = _to_cents(price)

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
            seen_at=datetime.utcnow(),
        )


def _diameter_at_least(url: str, min_mm: int) -> bool:
    m = DIAMETER_IN_URL_RE.search(url)
    if not m:
        return False
    return int(m.group(1)) >= min_mm


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
        if stock_count is not None and stock_count > 0:
            return StockStatus.IN_STOCK_WITH_COUNT
        return StockStatus.IN_STOCK
    if "outofstock" in a or OOS_TEXT_RE.search(html):
        return StockStatus.OUT_OF_STOCK
    return StockStatus.UNKNOWN


def _to_cents(price) -> int | None:
    if price is None:
        return None
    try:
        return int(round(float(price) * 100))
    except (TypeError, ValueError):
        return None
