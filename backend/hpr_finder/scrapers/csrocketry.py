"""Scraper for Chris' Rocket Supplies (csrocketry.com).

Approach (validated by spike 2026-05-23):
  1. Fetch /sitemap.xml.gz, gunzip, extract every URL matching
     /rocket-motors/aerotech-rocketry/motors/.../aerotech-*-rocket-motor.html
  2. For each product URL: parse the Product JSON-LD block for name, sku,
     price, availability. Extract "Stock Level: N" div separately for the
     numeric in-stock count.
"""
from __future__ import annotations

import gzip
import json
import logging
import re
from datetime import datetime

from ..http import PoliteClient
from ..models import Listing, StockStatus
from ..normalize import extract_designation
from .base import Scraper

log = logging.getLogger(__name__)

SITEMAP_URL = "https://www.csrocketry.com/sitemap.xml.gz"
PRODUCT_URL_RE = re.compile(
    r"https://www\.csrocketry\.com/rocket-motors/aerotech-rocketry/motors/"
    r"[^<\s]+aerotech-[^<\s]+-rocket-motor\.html"
)
DIAMETER_IN_URL_RE = re.compile(r"/motors/(\d+)mm/")
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
    min_request_interval_s = 30.0

    min_diameter_mm: int = 0  # 29 = HPR-only

    def scrape(self, client: PoliteClient, limit: int | None = None) -> list[Listing]:
        urls = sorted(self._discover_product_urls(client))
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
        listings: list[Listing] = []
        for url in urls:
            try:
                listings.append(self._scrape_product(client, url))
            except Exception as e:
                log.warning("csrocketry: skipping %s: %s", url, e)
        return listings

    def _discover_product_urls(self, client: PoliteClient) -> set[str]:
        r = client.get(SITEMAP_URL)
        r.raise_for_status()
        # The sitemap is gzipped XML; httpx may auto-decompress if Content-Encoding
        # is set, but the .xml.gz file is gzip-encoded payload, not transport encoding.
        raw = r.content
        try:
            text = gzip.decompress(raw).decode("utf-8", errors="replace")
        except OSError:
            # Already decompressed (rare)
            text = raw.decode("utf-8", errors="replace")
        return set(PRODUCT_URL_RE.findall(text))

    def _scrape_product(self, client: PoliteClient, url: str) -> Listing:
        r = client.get(url)
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
