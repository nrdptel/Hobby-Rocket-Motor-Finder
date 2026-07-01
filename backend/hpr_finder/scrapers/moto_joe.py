"""Async scraper for Moto-Joe Rocketry (moto-joe.com).

Moto-Joe runs OpenCart, which gives a clean structure: motors live under two
brand subcategories — Aerotech (``path=59_66``) and Cesaroni (``path=59_67``) —
so the category path itself tells us the manufacturer. Each category lists
~100 products/page (``&limit=100``) with the product id, designation-style name,
and price.

The catch: OpenCart doesn't put stock status on the category listing, only on the
product page (``Availability: Out Of Stock`` / a numeric quantity when in stock).
So discovery is a handful of category-page GETs, and stock comes from one GET per
product — the same per-product pattern the csrocketry scraper already uses, at a
comparable scale (~550 products).

Per product we read, from the product page: the H1 name (the designation), the
full description (which for Cesaroni carries the ``ProNN`` diameter and the
propellant flavor, e.g. "Motor reload, Pro29, 1G, Blue Streak"), and the
Availability field. Price comes from the category page, which shows it even for
out-of-stock items (the product page hides price when out of stock).

Stock signal is real here — in-stock products report a numeric quantity, so they
map to ``in_stock_with_count``; "Out Of Stock" maps to ``out_of_stock``. Motors
are mostly out of stock during the shortage, but that's genuine data, and a
restock surfaces immediately (and is caught by the history/watchlist layer).
"""
from __future__ import annotations

import asyncio
import html as _html
import logging
import re

from ..http import PoliteAsyncClient
from ..models import Listing, StockStatus, _utc_now
from ..normalize import extract_cti_designation, extract_designation
from .base import Scraper
from .prices import price_to_cents

log = logging.getLogger(__name__)

BASE_URL = "https://www.moto-joe.com"
AEROTECH = "AeroTech"
CESARONI = "Cesaroni Technology"
# (category path, manufacturer, designation extractor).
CATEGORIES: tuple[tuple[str, str], ...] = (
    ("59_66", AEROTECH),
    ("59_67", CESARONI),
)
_EXTRACTORS = {AEROTECH: extract_designation, CESARONI: extract_cti_designation}
_PAGE_LIMIT = 100
_MAX_PAGES = 20  # safety stop; each brand is ~3 pages at limit=100

_THUMB_RE = re.compile(r'<div class="product-thumb">', re.I)
_PRODUCT_ID_RE = re.compile(r"product_id=(\d+)")
_NAME_RE = re.compile(r"<h4><a[^>]*>([^<]+)</a></h4>", re.I)
_PRICE_BLOCK_RE = re.compile(r'class="price">(.*?)</p>', re.S | re.I)
_PRICE_RE = re.compile(r"\$([\d,]+\.\d{2})")
_TOTAL_PAGES_RE = re.compile(r"\((\d+)\s*Pages?\)", re.I)
_H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S | re.I)
_DESC_RE = re.compile(r'id="tab-description"[^>]*>(.*?)</div>', re.S | re.I)
_AVAIL_RE = re.compile(r"Availability:\s*(?:</span>)?\s*([^<\n]+)", re.I)
_TAG_RE = re.compile(r"<[^>]+>")
# Out-of-scope brands that Moto-Joe files under the Aerotech/Cesaroni categories
# (Kosdon-by-AeroTech, AMW). They aren't in our catalog, so skip them rather than
# leave them in the unmatched bucket. "Kodson" is a real misspelling on the site.
# See [[project-manufacturer-scope-locked]].
_SKIP_BRAND_RE = re.compile(r"kosdon|kodson|\bamw\b", re.I)
# Diameter: Cesaroni "Pro29", or "24mm", or AeroTech "98-7680" / "RMS-38".
_DIAM_PRO_RE = re.compile(r"pro\s*(\d{2,3})", re.I)
_DIAM_MM_RE = re.compile(r"(\d{2,3})\s*mm", re.I)
_DIAM_DASH_RE = re.compile(r"\b(\d{2,3})-\d{2,4}\b")
_DIAM_RMS_RE = re.compile(r"RMS-(\d{2,3})", re.I)


class MotoJoeScraper(Scraper):
    slug = "moto_joe"
    name = "Moto-Joe Rocketry"
    homepage = BASE_URL
    state = None  # not surfaced publicly
    # ~550 product-page GETs per run on a small OpenCart host — be gentle.
    max_concurrent_per_host = 2
    min_start_interval_s = 0.5

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        # 1) Discover products + prices from the brand category pages.
        discovered: dict[str, tuple[str, int | None, str]] = {}  # url -> (mfr, price, name)
        for path, manufacturer in CATEGORIES:
            for page in range(1, _MAX_PAGES + 1):
                r = await client.get(category_url(path, page))
                r.raise_for_status()
                rows = parse_category(r.text)
                if not rows:
                    break
                for row in rows:
                    url = product_url(row["product_id"])
                    discovered.setdefault(url, (manufacturer, row["price_cents"], row["name"]))
                if page >= (total_pages(r.text) or page):
                    break

        urls = list(discovered)
        if only_urls:
            wanted = set(only_urls)
            urls = [u for u in urls if u in wanted]
        if limit is not None:
            urls = urls[:limit]

        # 2) One product-page GET each for the (real) stock signal + full
        #    description. Individual failures are skipped, not fatal.
        async def fetch_one(url: str) -> Listing | None:
            manufacturer, price_cents, cat_name = discovered[url]
            try:
                r = await client.get(url)
                r.raise_for_status()
            except Exception as e:
                # Skip this product but leave a trail — every other scraper logs
                # its per-item fetch failures, and a silent drop here could bleed
                # stock without any signal (the exact staleness we alert on).
                log.warning("moto_joe: skipping %s: %s", url, e)
                return None
            return build_listing(r.text, url, manufacturer, price_cents, cat_name)

        results = await asyncio.gather(*(fetch_one(u) for u in urls))
        return [l for l in results if l is not None]


def category_url(path: str, page: int) -> str:
    return f"{BASE_URL}/index.php?route=product/category&path={path}&limit={_PAGE_LIMIT}&page={page}"


def product_url(product_id: str) -> str:
    return f"{BASE_URL}/index.php?route=product/product&product_id={product_id}"


def parse_category(html: str) -> list[dict]:
    """Parse an OpenCart category page into [{product_id, name, price_cents}]. Pure."""
    out: list[dict] = []
    blocks = _THUMB_RE.split(html)[1:]  # text before the first thumb is chrome
    for block in blocks:
        pid = _PRODUCT_ID_RE.search(block)
        name = _NAME_RE.search(block)
        if not pid or not name:
            continue
        out.append(
            {
                "product_id": pid.group(1),
                "name": _clean(name.group(1)),
                "price_cents": _block_price_cents(block),
            }
        )
    return out


def total_pages(html: str) -> int | None:
    """Total category pages from the "(N Pages)" results text, or None."""
    m = _TOTAL_PAGES_RE.search(html)
    return int(m.group(1)) if m else None


def build_listing(
    product_html: str,
    url: str,
    manufacturer: str,
    price_cents: int | None,
    cat_name: str,
) -> Listing | None:
    """Build a Listing from a product page. Returns None for non-motor pages
    (no recognizable designation). Pure (no network)."""
    name_m = _H1_RE.search(product_html)
    name = _clean(_TAG_RE.sub(" ", name_m.group(1))) if name_m else cat_name
    desc_m = _DESC_RE.search(product_html)
    desc = _clean(_TAG_RE.sub(" ", desc_m.group(1))) if desc_m else ""

    if _SKIP_BRAND_RE.search(f"{name} {desc}"):
        return None  # Kosdon / AMW filed under the AeroTech-Cesaroni categories

    designation = _EXTRACTORS[manufacturer](name) or _EXTRACTORS[manufacturer](f"{name} {desc}")
    if not designation:
        return None

    avail_m = _AVAIL_RE.search(product_html)
    status, stock_count = classify_availability(avail_m.group(1) if avail_m else "")
    product_id = _PRODUCT_ID_RE.search(url)
    return Listing(
        vendor_slug="moto_joe",
        motor_designation=designation,
        motor_id=None,
        url=url,
        sku=product_id.group(1) if product_id else None,
        price_cents=price_cents,
        currency="USD",
        status=status,
        stock_count=stock_count,
        raw_title=f"{name} {desc}".strip(),
        manufacturer=manufacturer,
        diameter_mm=parse_diameter(desc),
        seen_at=_utc_now(),
    )


def classify_availability(raw: str) -> tuple[StockStatus, int | None]:
    """Map an OpenCart Availability value to (status, count). In-stock products
    report a numeric quantity; out-of-stock products say so."""
    raw = raw.strip()
    if raw.isdigit():
        n = int(raw)
        return (StockStatus.IN_STOCK_WITH_COUNT, n) if n > 0 else (StockStatus.OUT_OF_STOCK, None)
    low = raw.lower()
    if "out of stock" in low or "sold out" in low or low == "0":
        return StockStatus.OUT_OF_STOCK, None
    if "in stock" in low or "available" in low:
        return StockStatus.IN_STOCK, None
    if "pre-order" in low or "pre order" in low or "backorder" in low or "days" in low:
        return StockStatus.SPECIAL_ORDER, None
    return StockStatus.UNKNOWN, None


def parse_diameter(text: str) -> int | None:
    """Diameter (mm) from a description: Cesaroni ``Pro29`` -> 29, else ``24mm`` /
    AeroTech ``98-7680`` / ``RMS-38`` forms."""
    for pat in (_DIAM_PRO_RE, _DIAM_MM_RE, _DIAM_DASH_RE, _DIAM_RMS_RE):
        m = pat.search(text)
        if m:
            return int(m.group(1))
    return None


def _block_price_cents(block: str) -> int | None:
    pb = _PRICE_BLOCK_RE.search(block)
    if not pb:
        return None
    m = _PRICE_RE.search(pb.group(1))  # first $ amount (handles price-new/old)
    return price_to_cents(m.group(1)) if m else None


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", _html.unescape(text)).strip()
