"""Async scraper for Animal Motor Works (cart.amwprox.com).

AMW runs Joomla + VirtueMart. The win: status (``"N In Stock"`` / ``"Call"`` /
``"Pre-Order"``), price, name, and motor designation are ALL on the category
listing page — we don't need to fetch individual product pages.

AMW exposes AeroTech motors under MULTIPLE overlapping taxonomies (verified
by exhaustive cat-ID scan 2026-05-23):
  * 104 = DMS (parent, lists ALL DMS motors flat)
  * 124 = Single Use (parent, lists ALL SU motors flat)
  * 110-114 = DMS by diameter (subsets of 104)
  * 116-121 = RMS by diameter (parent 105 is empty — this IS the only RMS view)
  * 130, 132, 134, 135 = 29mm RMS reload-size sub-cats
  * 137-144 = 38mm RMS reload-size sub-cats
  * 145-156 = 54mm + 75mm RMS reload-size sub-cats
  * 157-165 = 98mm RMS reload-size sub-cats
  * 107 = Quest (low-power Q-Jet — skipped, not in scope)
  * 102 = Aerotech parent (just FirstFire igniters — skipped, not motors)

The scraper visits all of these and dedupes by product ID, ensuring full
RMS coverage (which lives only in the leaf categories).

Status mapping:
  * ``"N In Stock"``  -> IN_STOCK_WITH_COUNT (N parsed)
  * ``"Call"``         -> SPECIAL_ORDER (vendor wants you to call/inquire)
  * ``"Pre-Order"``    -> SPECIAL_ORDER
  * no marker          -> UNKNOWN (defensive; AMW removes OOS items from
                          listings rather than marking them)

OOS detection: AMW hides out-of-stock items from listings entirely, so we
can't see them in real-time. A future enhancement could compare consecutive
scrape snapshots and mark anything missing-now-vs-before as OUT_OF_STOCK.
"""
from __future__ import annotations

import asyncio
import logging
import re

from ..http import PoliteAsyncClient
from ..models import Listing, StockStatus, _utc_now
from ..normalize import extract_designation
from .base import Scraper
from .prices import price_to_cents

log = logging.getLogger(__name__)

BASE_URL = "https://cart.amwprox.com"

# AeroTech motor category IDs at AMW. Multiple overlapping taxonomies — dedupe
# by product ID across all of them. Skip Quest (107, low-power Q-Jet) and the
# Aerotech parent (102, FirstFire igniters only).
CATEGORY_IDS = [
    104,  # DMS (parent, all)
    124,  # Single Use (parent, all)
    # DMS by diameter
    110, 111, 112, 113, 114,
    # RMS by diameter (parent 105 is empty; these ARE the only RMS view)
    116, 117, 118, 119, 120, 121,
    # SU by diameter
    125, 126, 127,
    # Reload-size sub-cats (RMS, by diameter/impulse)
    128, 129, 130, 132, 134, 135,           # 29mm reload sizes
    137, 138, 139, 140, 141, 142, 143, 144,  # 38mm reload sizes
    145, 146, 147, 148, 149, 150,            # 54mm reload sizes
    151, 152, 153, 154, 155, 156,            # 75mm reload sizes
    157, 158, 160, 161, 162, 163, 165,       # 98mm reload sizes + 75/10240
]

CATEGORY_URL_TEMPLATE = (
    BASE_URL
    + "/index.php?option=com_virtuemart&view=category"
    + "&virtuemart_category_id={cid}&Itemid=533&limit=150"
)
PRODUCT_BLOCK_SPLIT_RE = re.compile(r'(?=<div class="product floatleft)')
PRODUCT_ID_RE = re.compile(r"virtuemart_product_id=(\d+)")
TITLE_ATTR_RE = re.compile(
    r'<a\s+title="([^"]+)"\s+href="[^"]*virtuemart_product_id=', re.I
)
STATUS_RE = re.compile(
    r"(?P<count>\d+)\s*In\s*Stock|(?P<call>Call)(?=\s|<)|(?P<preorder>Pre-?Order)",
    re.I,
)
PRICE_RE = re.compile(r'PricesalesPrice"[^>]*>\$(\d+\.\d{2})')
DESC_RE = re.compile(r'product_s_desc"[^>]*>\s*([^<]+)\s*<')
URL_RE = re.compile(
    r'href="(/index\.php[^"]*virtuemart_product_id=\d+[^"]*)"'
)


class AMWScraper(Scraper):
    slug = "amw"
    name = "Animal Motor Works"
    homepage = "https://cart.amwprox.com"
    state = "AZ"
    # Small Joomla site on shared hosting — be conservative.
    max_concurrent_per_host = 2
    min_start_interval_s = 1.0

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        if only_urls:
            # AMW's URL scheme is category-driven; ad-hoc URL lookups aren't
            # supported (each product page also lives behind the same query
            # string mess). Not used by us so far.
            log.warning("amw: --url is not supported (category-page-driven scrape)")
            return []

        cat_urls = [CATEGORY_URL_TEMPLATE.format(cid=cid) for cid in CATEGORY_IDS]

        async def _safe(cat_url: str) -> list[Listing]:
            try:
                r = await client.get(cat_url)
                r.raise_for_status()
                return self._parse_category(r.text)
            except Exception as e:
                log.warning("amw: category fetch failed %s: %s", cat_url, e)
                return []

        results = await asyncio.gather(*[_safe(u) for u in cat_urls])
        # Dedupe by product ID (sku) — multiple overlapping AMW taxonomies
        # list the same motor in multiple categories. Keep the first seen.
        seen: set[str] = set()
        listings: list[Listing] = []
        for lst in results:
            for l in lst:
                key = l.sku or l.url
                if key in seen:
                    continue
                seen.add(key)
                listings.append(l)
        log.info(
            "amw: parsed %d total rows across %d categories, %d unique products after dedupe",
            sum(len(lst) for lst in results), len(cat_urls), len(listings),
        )
        if limit is not None:
            listings = listings[:limit]
        return listings

    def _parse_category(self, html: str) -> list[Listing]:
        listings: list[Listing] = []
        seen_pids: set[str] = set()
        for block in PRODUCT_BLOCK_SPLIT_RE.split(html):
            if "productdetails&virtuemart_product_id=" not in block:
                continue
            pid_m = PRODUCT_ID_RE.search(block)
            if not pid_m:
                continue
            pid = pid_m.group(1)
            if pid in seen_pids:
                continue
            seen_pids.add(pid)
            title_m = TITLE_ATTR_RE.search(block)
            title = title_m.group(1).strip() if title_m else ""
            desc_m = DESC_RE.search(block)
            desc = desc_m.group(1).strip() if desc_m else ""
            price_m = PRICE_RE.search(block)
            price_cents = price_to_cents(price_m.group(1) if price_m else None)
            url_m = URL_RE.search(block)
            relative_url = url_m.group(1) if url_m else ""
            url = (BASE_URL + relative_url) if relative_url else ""

            # The desc field carries the actual designation (e.g.,
            # "F115SN-12A 29mm DMS"), more useful than the bare title
            # ("F115SN DMS") because the desc preserves the delay code.
            raw_title = desc or title
            designation = extract_designation(raw_title) or extract_designation(title)
            if designation is None:
                # Not a motor (e.g., "Universal Delay Drilling Tool" — appears
                # in motor categories but is an accessory). Skip.
                continue

            status, stock_count = _parse_status(block)

            listings.append(
                Listing(
                    vendor_slug=self.slug,
                    motor_designation=designation,
                    motor_id=None,
                    url=url,
                    sku=pid,  # AMW's stable internal product ID
                    price_cents=price_cents,
                    currency="USD",
                    status=status,
                    stock_count=stock_count,
                    raw_title=raw_title,
                    seen_at=_utc_now(),
                )
            )
        return listings


def _parse_status(block: str) -> tuple[StockStatus, int | None]:
    m = STATUS_RE.search(block)
    if not m:
        return StockStatus.UNKNOWN, None
    if m.group("count") is not None:
        n = int(m.group("count"))
        # "0 In Stock" means sold out, not in-stock-with-count-zero.
        return (StockStatus.IN_STOCK_WITH_COUNT, n) if n > 0 else (StockStatus.OUT_OF_STOCK, None)
    if m.group("call") or m.group("preorder"):
        return StockStatus.SPECIAL_ORDER, None
    # Unreachable: a STATUS_RE match always sets exactly one of count/call/
    # preorder. Kept as a defensive fallback.
    return StockStatus.UNKNOWN, None  # pragma: no cover
