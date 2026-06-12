"""Async scraper for Loki Research (lokiresearch.com, MO).

Loki sells manufacturer-direct from a small custom ASP store. Unlike the other
vendors there's no sitemap, JSON API, or per-product pages to walk: the ENTIRE
reload catalog lives in one table on a single "hobby certified reloads" group
page, one ``<tr>`` per motor. So discovery is a single GET and parsing is a
table walk — the simplest scraper here.

Each row carries:
  * a ``storeDetail.asp?id=<id>`` link  -> stable per-listing id (url + sku)
  * a dedicated designation cell        -> e.g. "N-5500-LW"
  * propellant / delay / impulse / case / price cells
  * a stock signal: "TEMPORARILY OUT OF STOCK", or "Made to order / Allow N
    weeks" (special order), else an in-stock quantity input.

Loki designations differ from AeroTech's grammar only by a hyphen between the
class letter and thrust ("N-5500-LW"); :func:`extract_loki_designation`
collapses it so the shared matcher resolves Loki via its (unique) commonNames —
no Loki-specific match strategy. Listings are tagged manufacturer
"Loki Research" (the name ThrustCurve stores) so they match the Loki catalog.
"""
from __future__ import annotations

import re

from ..http import PoliteAsyncClient
from ..models import Listing, StockStatus, _utc_now
from ..normalize import extract_loki_designation
from .base import Scraper
from .prices import price_to_cents

BASE_URL = "https://lokiresearch.com"
# The single "hobby certified reloads" group page holds the full catalog.
RELOADS_URL = f"{BASE_URL}/secure/store.asp?groupid=831200410431019"
MANUFACTURER = "Loki Research"  # the name ThrustCurve stores

STORE_ID_RE = re.compile(r"storeDetail\.asp\?id=(\d+)", re.I)
PRICE_RE = re.compile(r"\$([\d,]+\.\d{2})")
# A cell whose entire text is a Loki designation, e.g. "N-5500-LW", "G94-IB",
# "HP-G-69-SF" (some G-class reloads carry an HP- prefix).
DESIG_CELL_RE = re.compile(r"^(?:HP-)?[G-O]-?\d{2,4}-?[A-Z]{2}$", re.I)
# Split on table rows / cells with regex rather than a DOM parser: the store's
# markup is invalid (nested <a> tags), which makes a DOM parser restructure the
# tree and emit duplicate/mis-scoped rows. Each product is one flat <tr> with no
# nested table, so a non-greedy row split is exact.
_TR_RE = re.compile(r"<tr\b.*?</tr>", re.S | re.I)
_TD_RE = re.compile(r"<td\b[^>]*>(.*?)</td>", re.S | re.I)
_TAG_RE = re.compile(r"<[^>]+>")


class LokiScraper(Scraper):
    slug = "loki"
    name = "Loki Research"
    homepage = BASE_URL
    state = "MO"
    # Single small page on a manufacturer-direct site — be gentle.
    max_concurrent_per_host = 2
    min_start_interval_s = 1.0

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        # One page is the whole reload catalog. ``only_urls`` is irrelevant here
        # (there is no per-product discovery to skip) and ignored.
        r = await client.get(RELOADS_URL)
        r.raise_for_status()
        listings = parse_reloads(r.text)
        if limit is not None:
            listings = listings[:limit]
        return listings


def _cell_text(html: str) -> str:
    return re.sub(r"\s+", " ", _TAG_RE.sub(" ", html)).strip()


def parse_reloads(html: str) -> list[Listing]:
    """Parse the reloads table into Listings. Pure (no network) for testing."""
    seen_at = _utc_now()
    out: list[Listing] = []
    for row in _TR_RE.findall(html):
        id_match = STORE_ID_RE.search(row)
        if not id_match:
            continue
        cells = [_cell_text(c) for c in _TD_RE.findall(row)]
        raw_designation = next((c for c in cells if DESIG_CELL_RE.match(c)), None)
        price_cents = _price_cents(cells)
        if raw_designation is None or price_cents is None:
            continue
        designation = extract_loki_designation(raw_designation)
        if not designation:
            continue
        item_id = id_match.group(1)
        idx = cells.index(raw_designation)
        propellant = cells[idx + 1] if idx + 1 < len(cells) else ""
        out.append(
            Listing(
                vendor_slug="loki",
                motor_designation=designation,
                motor_id=None,
                url=f"{BASE_URL}/secure/storeDetail.asp?id={item_id}",
                sku=item_id,
                price_cents=price_cents,
                currency="USD",
                status=_classify_status(_cell_text(row)),
                stock_count=None,  # Loki doesn't publish counts
                raw_title=f"Loki {raw_designation} {propellant}".strip(),
                manufacturer=MANUFACTURER,
                seen_at=seen_at,
            )
        )
    return out


def _price_cents(cells: list[str]) -> int | None:
    for cell in cells:
        m = PRICE_RE.search(cell)
        if m:
            return price_to_cents(m.group(1))
    return None


def _classify_status(row_text: str) -> StockStatus:
    # Order matters: a made-to-order row still renders a qty input, so check the
    # out-of-stock and made-to-order markers before defaulting to in-stock.
    if re.search(r"out of stock", row_text, re.I):
        return StockStatus.OUT_OF_STOCK
    if re.search(r"made to order|allow [\d\s-]*weeks", row_text, re.I):
        return StockStatus.SPECIAL_ORDER
    return StockStatus.IN_STOCK
