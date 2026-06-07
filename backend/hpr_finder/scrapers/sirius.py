"""Async scraper for Sirius Rocketry (siriusrocketry.biz, WI).

Sirius runs Zen Cart. No Schema.org JSON-LD, no agentic /products.json API.
Discovery uses the AeroTech manufacturer page (manufacturer_id=1), which
lists every AeroTech product across all category trees in a single paginated
view:

  /ishop/manufacturers/aerotech-1/                  page 1
  /ishop/manufacturers/aerotech-1/index-N.html      pages 2..N

Earlier versions BFS-crawled the HPR category tree
(``/high-power-rocket-motors-hdw-57/``); that missed every D-G mid-power
reload (lives under ``/hobby-rocket-motors-engines-hdw-36/``) and the
HAZMAT reload-kit pages that aren't reachable from the HPR landing. The
manufacturer page catches all of them in one walk.

Each listing on the manufacturer page is itself a product link; we collect
those, filter to titles with a recognizable AeroTech designation
(``extract_designation`` non-None — excludes case packs, retainers, kits,
etc.), and fetch each unique product page for price/status.

Status mapping (per product page):
  * ``button_in_cart`` image + price visible  -> IN_STOCK (Sirius doesn't
                                                  publish numeric inventory)
  * ``button_sold_out`` image + "Special Order" in title -> SPECIAL_ORDER
                                                  (Sirius's unique state —
                                                  they'll order it for you on
                                                  request)
  * ``button_sold_out`` image, no "Special Order" -> OUT_OF_STOCK
  * neither marker -> UNKNOWN

Politeness: small Wisconsin retailer on shared hosting — 2 concurrent +
1s start cadence.
"""
from __future__ import annotations

import asyncio
import logging
import re

from ..http import PoliteAsyncClient
from ..models import Listing, StockStatus, _utc_now
from ..normalize import extract_designation
from .base import Scraper

log = logging.getLogger(__name__)

BASE_URL = "https://www.siriusrocketry.biz"
# Page 1 of the AeroTech manufacturer listing. Subsequent pages are at
# /ishop/manufacturers/aerotech-1/index-N.html (N >= 2).
MANUFACTURER_PAGE_URL = f"{BASE_URL}/ishop/manufacturers/aerotech-1/"
# Hard cap on pagination — Sirius currently has 537 products (~11 pages at 50
# per page). Cap well above that to survive growth without runaway loops.
MAX_MANUFACTURER_PAGES = 30

# Product URL: <slug>-<numeric-id>.html under /ishop/, where the slug begins
# with "aerotech" or "enerjet-by-aerotech" (AeroTech's mid-power EnerJet line
# uses the latter prefix — e.g. enerjet-by-aerotech-e30-4t-...). The trailing
# numeric ID is Zen Cart's product_id. Sirius's AeroTech manufacturer page
# also lists cross-referenced Estes/Sirius items by this association; the
# prefix filter screens those without an extra fetch.
PRODUCT_URL_RE = re.compile(
    r'href="(' + re.escape(BASE_URL) + r'/ishop/(?:aerotech|enerjet-by-aerotech)[^"]+-\d+\.html)"'
)
# Total-product count from manufacturer page footer:
#   <div ... navSplitPagesResult ...>Displaying <strong>1</strong> to
#       <strong>50</strong> (of <strong>537</strong> Products)</div>
# The intervening tags vary, so match loosely on "(of <strong>N</strong>".
TOTAL_PRODUCTS_RE = re.compile(
    r'navSplitPagesResult.*?\(of\s*<strong>(\d+)</strong>', re.I | re.S
)
H1_RE = re.compile(r'<h1[^>]*>(.*?)</h1>', re.S)
# Prices in Sirius's Zen Cart theme:
#   * normalprice            -- the list / MSRP, often struck through when on sale
#   * productSalePrice       -- the current selling price (Sirius's theme; note:
#                                generic Zen Cart usually calls this
#                                productSpecialPrice, but Sirius uses Sale).
#                                Format: "Sale:&nbsp;$614.21"
#   * productSpecialPrice    -- generic Zen Cart class (fallback if Sirius ever
#                                reverts)
#   * productGeneralPrice    -- single-price products (no sale)
# Preference: sale > special > general > normal — pick the actual price the
# customer would pay if they hit "Add to Cart".
PRICE_RE = {
    "sale": re.compile(r'productSalePrice[^>]*>[^<]*?\$([\d,]+\.\d{2})'),
    "special": re.compile(r'productSpecialPrice[^>]*>[^<]*?\$([\d,]+\.\d{2})'),
    "general": re.compile(r'productGeneralPrice[^>]*>[^<]*?\$([\d,]+\.\d{2})'),
    "normal": re.compile(r'normalprice[^>]*>[^<]*?\$([\d,]+\.\d{2})'),
}
# The MAIN product's price lives in Zen Cart's "Product Price block":
#   <h2 id="productPrices" ...> ...prices... </h2> <!--eof Product Price block -->
# Price extraction must be scoped to THIS block. The same product page also
# renders OTHER products' prices (identical CSS classes) in rotating
# "also purchased" / "what's new" boxes lower down; a whole-page search picks
# those up whenever the main block has no visible price (e.g. some sold-out
# items), making that product's recorded price oscillate run-to-run as the
# boxes rotate. Anchoring to the block returns the real price, or None when the
# product genuinely shows no price — never a neighbor's.
PRODUCT_PRICE_BLOCK_RE = re.compile(r'id="productPrices".*?eof Product Price block', re.S)
SOLD_OUT_BUTTON_RE = re.compile(r'button_sold_out', re.I)
IN_CART_BUTTON_RE = re.compile(r'button_in_cart', re.I)
PRODUCT_ID_FROM_URL_RE = re.compile(r"-(\d+)\.html$")


class SiriusScraper(Scraper):
    slug = "sirius"
    name = "Sirius Rocketry"
    homepage = BASE_URL
    state = "WI"
    # Small shared-hosting retailer — conservative.
    max_concurrent_per_host = 2
    min_start_interval_s = 1.0

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        if only_urls:
            product_urls = sorted(set(only_urls))
            log.info("sirius: scraping %d explicit URLs", len(product_urls))
        else:
            product_urls = sorted(await self._crawl_for_products(client))
            log.info("sirius: discovered %d AeroTech product URLs", len(product_urls))
        if limit is not None:
            product_urls = product_urls[:limit]

        async def _safe(url: str) -> Listing | None:
            try:
                return await self._scrape_product(client, url)
            except Exception as e:
                log.warning("sirius: skipping %s: %s", url, e)
                return None

        results = await asyncio.gather(*[_safe(u) for u in product_urls])
        return [r for r in results if r is not None]

    async def _crawl_for_products(self, client: PoliteAsyncClient) -> set[str]:
        """Paginate the AeroTech manufacturer page and collect every product URL.

        Walks ``/ishop/manufacturers/aerotech-1/`` then ``index-2.html``,
        ``index-3.html``, ... stopping when a page returns no product URLs
        not already seen (so a single empty page → done). On page 1 we also
        parse the "(of N Products)" total and log it for sanity-checking
        against the count we return.

        Each page lists *every* AeroTech product regardless of which category
        tree it lives in, so we don't need the old HPR-tree BFS.
        """
        product_urls: set[str] = set()
        expected_total: int | None = None
        paginated_to_end = False
        for page in range(1, MAX_MANUFACTURER_PAGES + 1):
            url = (
                MANUFACTURER_PAGE_URL
                if page == 1
                else f"{MANUFACTURER_PAGE_URL}index-{page}.html"
            )
            try:
                r = await client.get(url)
                r.raise_for_status()
            except Exception as e:
                log.warning("sirius: manufacturer page %d fetch failed (%s): %s", page, url, e)
                break

            html = r.text
            if page == 1:
                total_match = TOTAL_PRODUCTS_RE.search(html)
                if total_match:
                    expected_total = int(total_match.group(1))
                    log.info("sirius: manufacturer page reports %d total products", expected_total)

            new = set(PRODUCT_URL_RE.findall(html)) - product_urls
            if not new:
                # End of pagination: this page yielded no products we haven't
                # already seen on a prior page.
                log.info("sirius: pagination exhausted at page %d", page)
                paginated_to_end = True
                break
            product_urls.update(new)
            log.debug("sirius: page %d added %d products (total so far: %d)", page, len(new), len(product_urls))

        # ``expected_total`` counts ALL products on the manufacturer page —
        # including AeroTech hardware (RMS casings/closures/seal discs, slugged
        # ``rms-*`` not ``aerotech-*``) and rotating cross-sell items from other
        # brands — so it is legitimately HIGHER than the motor-only URLs we keep.
        # Only warn about a real pagination failure: hitting the page cap without
        # ever reaching an empty page (a runaway or an early stop), not the
        # expected count gap.
        if not paginated_to_end:
            log.warning(
                "sirius: hit the %d-page cap without exhausting pagination "
                "(discovered %d product URLs; page advertised %s total) — "
                "pagination may be truncated or the cap too low",
                MAX_MANUFACTURER_PAGES,
                len(product_urls),
                expected_total,
            )

        log.info("sirius: discovered %d AeroTech product URLs (filtering for motors at fetch time)", len(product_urls))
        return product_urls

    async def _scrape_product(self, client: PoliteAsyncClient, url: str) -> Listing | None:
        r = await client.get(url)
        r.raise_for_status()
        html = r.text

        h1_match = H1_RE.search(html)
        if not h1_match:
            raise ValueError("no <h1> on product page")
        title = re.sub(r"<[^>]+>", " ", h1_match.group(1))
        title = re.sub(r"\s+", " ", title).strip()
        if not title:
            raise ValueError("empty title")

        designation = extract_designation(title)
        if designation is None:
            # Page exists but isn't a motor (could be a kit/accessory in the
            # HPR motors category tree that we mistakenly crawled).
            return None

        price_cents = _extract_price_cents(html)
        status = _classify_status(html, title)
        sku = _product_id_from_url(url)

        return Listing(
            vendor_slug=self.slug,
            motor_designation=designation,
            motor_id=None,
            url=url,
            sku=sku,
            price_cents=price_cents,
            currency="USD",
            status=status,
            stock_count=None,  # Sirius doesn't publish counts
            raw_title=title,
            seen_at=_utc_now(),
        )


def _extract_price_cents(html: str) -> int | None:
    # Scope to the main product price block so rotating "also purchased" /
    # "what's new" boxes can't leak a neighbor's price (see PRODUCT_PRICE_BLOCK_RE).
    block_match = PRODUCT_PRICE_BLOCK_RE.search(html)
    if not block_match:
        return None
    block = block_match.group(0)
    # Prefer sale > special > general > normal — what the customer would pay.
    for key in ("sale", "special", "general", "normal"):
        m = PRICE_RE[key].search(block)
        if m:
            try:
                return int(round(float(m.group(1).replace(",", "")) * 100))
            except ValueError:
                continue
    return None


def _classify_status(html: str, title: str) -> StockStatus:
    has_sold_out = bool(SOLD_OUT_BUTTON_RE.search(html))
    has_in_cart = bool(IN_CART_BUTTON_RE.search(html))
    is_special_order = "special order" in title.lower()
    if is_special_order:
        return StockStatus.SPECIAL_ORDER
    if has_in_cart and not has_sold_out:
        return StockStatus.IN_STOCK
    if has_sold_out:
        return StockStatus.OUT_OF_STOCK
    return StockStatus.UNKNOWN


def _product_id_from_url(url: str) -> str | None:
    m = PRODUCT_ID_FROM_URL_RE.search(url)
    return m.group(1) if m else None
