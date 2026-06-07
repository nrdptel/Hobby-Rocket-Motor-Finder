"""Async scraper for eRockets (erockets.biz, OH).

eRockets is a BigCommerce store. We only pull its AeroTech motor catalog, which
lives in two category trees — single-use and reloadable — so discovery is a
handful of paginated category-page GETs (no per-product fetch needed: the
category cards already carry the name, price, and stock state). That keeps the
footprint small, which matters here because eRockets' robots.txt carries a large
AI-/scraper-bot blocklist; our identifying UA falls under the permissive ``*``
rules (only cart/checkout/admin paths are disallowed), and we stay gentle.

eRockets stocks low/mid-power AeroTech (roughly E–H class) — no Cesaroni or Loki
— but the stock signal is clean: each ``<li class="product">`` card shows an
"Add to Cart" button when in stock or "Sorry, Out of Stock" otherwise, plus the
price and a title that carries the designation
(``Aerotech 29mm ... Single Use F26-9FJ(1pk) AER 62609``). Non-motor cards
(grease, wrenches, charge canisters) yield no designation and are skipped.
"""
from __future__ import annotations

import html as _html
import re

from ..http import PoliteAsyncClient
from ..models import Listing, StockStatus, _utc_now
from ..normalize import extract_designation
from .base import Scraper

BASE_URL = "https://www.erockets.biz"
MANUFACTURER = "AeroTech"
# AeroTech motor category slugs (single-use + reloadable). Hardware/casings live
# in other categories we deliberately don't crawl.
CATEGORIES = ("aerotech-single-use-motors", "aerotech-reloadable-motors")
_MAX_PAGES = 12  # safety stop; each category is ~2-3 pages

# Split on each card's START rather than matching `...</li>` non-greedily: a card
# can contain nested <li> (option swatches, badges) that would truncate a
# `.*?</li>` match and silently drop the product. Each split segment runs from one
# card start to the next; per-card regexes below take the first match in it.
_CARD_SPLIT_RE = re.compile(r'(?=<li class="product[^"]*")', re.I)
_IS_CARD_RE = re.compile(r'^<li class="product', re.I)
_TITLE_RE = re.compile(
    r'<h\d[^>]*class="card-title"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S | re.I
)
_PRICE_RE = re.compile(r"\$([\d,]+\.\d{2})")
_PID_RE = re.compile(r'data-product-id="(\d+)"')
_TAG_RE = re.compile(r"<[^>]+>")


class ERocketsScraper(Scraper):
    slug = "erockets"
    name = "eRockets"
    homepage = BASE_URL
    state = "OH"
    # Few category-page GETs; host signals bot-wariness, so crawl slowly.
    max_concurrent_per_host = 1
    min_start_interval_s = 2.0

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        listings: list[Listing] = []
        seen_urls: set[str] = set()
        for category in CATEGORIES:
            for page in range(1, _MAX_PAGES + 1):
                r = await client.get(f"{BASE_URL}/{category}/?page={page}")
                r.raise_for_status()
                page_listings = [
                    l for l in parse_category(r.text) if l.url not in seen_urls
                ]
                if not page_listings:
                    break
                for l in page_listings:
                    seen_urls.add(l.url)
                listings.extend(page_listings)
                if limit is not None and len(listings) >= limit:
                    break
            if limit is not None and len(listings) >= limit:
                break

        if only_urls:
            wanted = set(only_urls)
            listings = [l for l in listings if l.url in wanted]
        if limit is not None:
            listings = listings[:limit]
        return listings


def parse_category(html: str) -> list[Listing]:
    """Parse a BigCommerce category page into motor Listings. Pure (no network).

    Cards without a recognizable AeroTech designation (grease, hardware,
    accessories) are skipped.
    """
    seen_at = _utc_now()
    out: list[Listing] = []
    for card in _CARD_SPLIT_RE.split(html):
        if not _IS_CARD_RE.match(card):
            continue
        tm = _TITLE_RE.search(card)
        if not tm:
            continue
        url = tm.group(1)
        title = _clean(tm.group(2))
        designation = extract_designation(title)
        if not designation:
            continue
        pid = _PID_RE.search(card)
        out.append(
            Listing(
                vendor_slug="erockets",
                motor_designation=designation,
                motor_id=None,
                url=url,
                sku=pid.group(1) if pid else None,
                price_cents=_first_price_cents(card),
                currency="USD",
                status=_classify_status(card),
                stock_count=None,  # category cards don't expose a count
                raw_title=title,
                manufacturer=MANUFACTURER,
                seen_at=seen_at,
            )
        )
    return out


def _classify_status(card: str) -> StockStatus:
    low = card.lower()
    if "out of stock" in low or "sold out" in low:
        return StockStatus.OUT_OF_STOCK
    # "Add to Cart" (simple product) or "Choose/View Options" (a reload with delay
    # variants) both mean the product is orderable. BigCommerce shows "Out of
    # Stock" instead once everything is gone, which the check above catches first.
    if "add to cart" in low or "choose options" in low or "view options" in low:
        return StockStatus.IN_STOCK
    return StockStatus.UNKNOWN


def _first_price_cents(card: str) -> int | None:
    m = _PRICE_RE.search(card)
    return int(round(float(m.group(1).replace(",", "")) * 100)) if m else None


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", _html.unescape(_TAG_RE.sub(" ", text))).strip()
