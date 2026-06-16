"""Async scraper for Balsa Machining Service (balsamachining.com, NV).

Balsa lists its entire high-power motor catalog on a single page
(``/hpmp.htm``) — one ``<TR VALIGN=TOP>`` per item, AeroTech only — so the whole
scrape is one GET and a row walk (the same shape as the Loki scraper, just a
bigger table).

The page is unusually friendly to parse because every motor row links to its
ThrustCurve page:

    <a href="https://www.thrustcurve.org/motors/AeroTech/I115W" ...>
        I115W-14A <span style="color:green"> 3  available</span></a>

That link gives the manufacturer authoritatively (and cleanly separates motors
from hardware/closures, which have no such link). Each row also carries:
  * a first cell with the vendor's catalog # (an alphanumeric SKU like ``07138L``
    / ``11250P``) — present whether in or out of stock, so it's the stable id;
  * the designation as the link text;
  * stock as ``N available`` (a real count -> in_stock_with_count) or
    ``out of stock``;
  * list + sale price (we take the sale price actually charged).

The markup is old hand-written HTML with no ``</TR>`` tags, so rows are split on
the ``<TR VALIGN=TOP>`` start rather than parsed as a DOM.
"""
from __future__ import annotations

import re

from ..http import PoliteAsyncClient
from ..models import Listing, StockStatus, _utc_now
from ..normalize import extract_cti_designation, extract_designation
from .base import Scraper
from .prices import price_to_cents

BASE_URL = "https://www.balsamachining.com"
HPM_URL = f"{BASE_URL}/hpmp.htm"
# ThrustCurve URL slug -> the manufacturer name our catalog stores. Balsa is
# AeroTech-only today; the map future-proofs the row parser if they add a brand.
_MFR_MAP = {
    "AeroTech": "AeroTech",
    "Cesaroni": "Cesaroni Technology",
    "Loki": "Loki Research",
}

_ROW_SPLIT_RE = re.compile(r"(?=<TR VALIGN=TOP>)", re.I)
_TC_RE = re.compile(r"thrustcurve\.org/motors/([^/]+)/([^\"?]+)", re.I)
# First cell of a row is the catalog # (alphanumeric SKU).
_CATALOG_RE = re.compile(r"<TD[^>]*>\s*<FONT[^>]*>\s*([0-9][0-9A-Za-z]{2,8})\s*</FONT>", re.I)
# Designation = link text after the thrust-curve anchor, up to the stock span /
# "out of stock" text / end of cell.
_DESIG_RE = re.compile(
    r'click for thrust curve">\s*(.*?)(?:<span|\s+out of stock|</a>|</FONT>)', re.I | re.S
)
_AVAIL_RE = re.compile(r"(\d+)\s*available", re.I)
_PRICE_RE = re.compile(r"\$([0-9,]+\.[0-9]{2})")
_TAG_RE = re.compile(r"<[^>]+>")


class BalsaMachiningScraper(Scraper):
    slug = "balsa_machining"
    name = "Balsa Machining Service"
    homepage = BASE_URL
    state = "NV"
    # One static page — be gentle.
    max_concurrent_per_host = 2
    min_start_interval_s = 1.0

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        r = await client.get(HPM_URL)
        r.raise_for_status()
        # Old IIS page; decode bytes as latin-1 (lossless for the ASCII tokens we
        # parse) rather than trusting a possibly-wrong declared charset.
        listings = parse_motors(r.content.decode("latin-1"))
        if only_urls:
            wanted = set(only_urls)
            listings = [l for l in listings if l.url in wanted]
        if limit is not None:
            listings = listings[:limit]
        return listings


def parse_motors(html: str) -> list[Listing]:
    """Parse the high-power motors page into Listings. Pure (no network).

    Only rows that link to a ThrustCurve motor page are motors; hardware,
    closures and accessories (no such link) are skipped.
    """
    seen_at = _utc_now()
    out: list[Listing] = []
    for row in _ROW_SPLIT_RE.split(html):
        tc = _TC_RE.search(row)
        if not tc:
            continue
        manufacturer = _MFR_MAP.get(tc.group(1), tc.group(1))
        catalog = _CATALOG_RE.search(row)
        desig_m = _DESIG_RE.search(row)
        if not catalog or not desig_m:
            continue
        extract = extract_cti_designation if manufacturer.lower().startswith("cesaroni") else extract_designation
        designation = extract(_clean(desig_m.group(1)))
        if not designation:
            continue
        sku = catalog.group(1)
        status, stock_count = _classify_stock(row)
        out.append(
            Listing(
                vendor_slug="balsa_machining",
                motor_designation=designation,
                motor_id=None,
                url=f"{HPM_URL}#{sku}",
                sku=sku,
                price_cents=_last_price_cents(row),
                currency="USD",
                status=status,
                stock_count=stock_count,
                raw_title=_clean(desig_m.group(1)),
                manufacturer=manufacturer,
                seen_at=seen_at,
            )
        )
    return out


def _classify_stock(row: str) -> tuple[StockStatus, int | None]:
    m = _AVAIL_RE.search(row)
    if m:
        n = int(m.group(1))
        # "0 available" is sold out, not in-stock-with-count-zero.
        return (StockStatus.IN_STOCK_WITH_COUNT, n) if n > 0 else (StockStatus.OUT_OF_STOCK, None)
    if re.search(r"out of stock", row, re.I):
        return StockStatus.OUT_OF_STOCK, None
    return StockStatus.UNKNOWN, None


def _last_price_cents(row: str) -> int | None:
    # In-stock rows show list price then the (lower) sale price in the add-to-cart
    # cell; out-of-stock rows show only the list price. The last $ is what's
    # charged (sale when present, list otherwise).
    prices = _PRICE_RE.findall(row)
    if not prices:
        return None
    return price_to_cents(prices[-1])


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", _TAG_RE.sub(" ", text).replace("&nbsp;", " ")).strip()
