"""Async scraper for Motorman Rocketry (the-motorman.net).

A Weebly storefront, and unusually valuable because it carries **Cesaroni** — our
thinnest-covered brand — alongside AeroTech, with per-item stock counts. The whole
catalog lives on two flat HTML pages (no per-product pages, no JSON API):
``/aerotech.html`` and ``/cti--cesaroni.html``. Each product is one ``<br>``-
separated line inside ``<div class="paragraph">`` blocks::

    <name> ............ $<price>  (<qty>)

``robots.txt`` is ``Disallow:`` (allow-all).

Stock convention (the page has NO legend): a trailing ``(N)`` means N in stock.
A line with NO ``(N)`` shows no current stock, so we read it as OUT_OF_STOCK —
the conservative direction (never claim stock the page doesn't show; tellingly,
the big/expensive 98mm CTI motors are exactly the ones with no count). ``(N)``
with N>0 → IN_STOCK_WITH_COUNT.

AeroTech: standard designations (``H283ST-15A``, ``I205W-14A``) that
:func:`extract_designation` handles; casings/closures carry no designation and
drop out.

Cesaroni: rows read ``"3G Reload 75 F51 -12A"`` — grain count, total impulse,
commonName, delay. The CTI match path keys on (commonName, flavor, diameter); the
diameter comes from the ``Pro<NN> Hardware and Reloads:`` section headers the page
groups reloads under (Pro24/29/38/54/75/98). Motorman doesn't spell out the
propellant flavor, so most CTI rows resolve on commonName+diameter; a commonName
with multiple flavors at one diameter is left unmatched rather than guessed (the
shared matcher refuses to coin-flip).

Both pages reuse one URL each, so we synthesize a unique per-row URL with a slug
fragment (``#<slug>``) to satisfy the ``(vendor, url)`` key and dedupe repeats.
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

BASE_URL = "https://www.the-motorman.net"
AEROTECH_URL = f"{BASE_URL}/aerotech.html"
CTI_URL = f"{BASE_URL}/cti--cesaroni.html"
# The manufacturer name ThrustCurve stores; routes the listing to the CTI match
# path (db.find_motor_id dispatches on a "cesaroni" prefix).
CESARONI_MANUFACTURER = "Cesaroni Technology"

PRICE_RE = re.compile(r"\$(\d[\d,]*\.\d{2})")
QTY_RE = re.compile(r"\((\d+)\)")
# Any "Pro<NN>" token marks a CTI section header or a hardware row (closures,
# casings) — never a reload-motor line — so it just sets the working diameter.
PRO_SIZE_RE = re.compile(r"(?i)\bPro\s?(\d{2,3})\b")
# Flatten Weebly HTML: break on <br> and block tags; strip inline tags in place
# so each product's name/price/qty stay on one line.
_BLOCK_RE = re.compile(r"(?i)<br\s*/?>|</?(?:div|p|li|h\d|tr|table)[^>]*>")
_TAG_RE = re.compile(r"<[^>]+>")


def _flatten(html_text: str) -> list[str]:
    text = _BLOCK_RE.sub("\n", html_text)
    text = _TAG_RE.sub("", text)
    text = _html.unescape(text).replace("\xa0", " ")
    return [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n") if ln.strip()]


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _qty_after_price(line: str, price_end: int) -> str | None:
    """The stock ``(N)`` always follows the price; only look past it so a stray
    parenthetical earlier in the name can't be misread as a count."""
    m = QTY_RE.search(line, price_end)
    return m.group(1) if m else None


def _status(qty: str | None) -> tuple[StockStatus, int | None]:
    if qty is None:
        return StockStatus.OUT_OF_STOCK, None
    n = int(qty)
    return (StockStatus.IN_STOCK_WITH_COUNT, n) if n > 0 else (StockStatus.OUT_OF_STOCK, None)


class MotormanScraper(Scraper):
    slug = "motorman"
    name = "Motorman Rocketry"
    homepage = BASE_URL
    state = None  # not surfaced on the site
    # Weebly on shared hosting; just two page GETs — be gentle.
    max_concurrent_per_host = 2
    min_start_interval_s = 1.0

    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        # Two flat catalog pages; only_urls is irrelevant (no per-product pages).
        async def _fetch(url: str, parse) -> list[Listing]:
            try:
                r = await client.get(url)
                r.raise_for_status()
                return parse(r.text)
            except Exception as e:  # isolate a single-page hiccup; floor/carry-forward covers it
                log.warning("motorman: %s failed: %s", url, e)
                return []

        at, cti = await asyncio.gather(
            _fetch(AEROTECH_URL, parse_aerotech),
            _fetch(CTI_URL, parse_cti),
        )
        log.info("motorman: parsed %d AeroTech + %d Cesaroni listings", len(at), len(cti))
        listings = at + cti
        if limit is not None:
            listings = listings[:limit]
        return listings


def parse_aerotech(html_text: str) -> list[Listing]:
    """Parse the AeroTech page into Listings. Pure (no network) for tests."""
    seen_at = _utc_now()
    out: list[Listing] = []
    seen: set[str] = set()
    for line in _flatten(html_text):
        price_m = PRICE_RE.search(line)
        if not price_m:
            continue
        designation = extract_designation(line)
        if not designation:
            continue  # hardware (casings/closures) or prose — not a motor
        # Motorman's AeroTech page spans A-class model motors up to M. The site
        # is unusual in carrying low-power; those aren't in our HPR catalog and
        # the app only shows D and up, so drop sub-D rather than pile them in the
        # unmatched bucket (which feeds the per-vendor match-rate health metric).
        if designation[0] < "D":
            continue
        slug = _slug(line)
        if slug in seen:
            continue
        seen.add(slug)
        status, count = _status(_qty_after_price(line, price_m.end()))
        out.append(
            Listing(
                vendor_slug="motorman",
                motor_designation=designation,
                motor_id=None,
                url=f"{AEROTECH_URL}#{slug}",
                sku=None,
                price_cents=price_to_cents(price_m.group(1)),
                currency="USD",
                status=status,
                stock_count=count,
                raw_title=line,
                seen_at=seen_at,
            )
        )
    return out


def parse_cti(html_text: str) -> list[Listing]:
    """Parse the Cesaroni page into Listings, carrying the per-section diameter.
    Pure (no network) for tests."""
    seen_at = _utc_now()
    out: list[Listing] = []
    seen: set[str] = set()
    diameter: int | None = None
    for line in _flatten(html_text):
        pro = PRO_SIZE_RE.search(line)
        if pro:
            # Section header or our-brand hardware (Pro<NN> closure/casing) — sets
            # the working diameter; never a reload-motor line, so skip as product.
            diameter = int(pro.group(1))
            continue
        if "reload" not in line.lower():
            continue  # casings/closures/nozzles/spacers — not a reload motor
        price_m = PRICE_RE.search(line)
        if not price_m:
            continue
        common = extract_cti_designation(line)
        if not common:
            continue
        slug = _slug(line)
        if slug in seen:
            continue
        seen.add(slug)
        status, count = _status(_qty_after_price(line, price_m.end()))
        out.append(
            Listing(
                vendor_slug="motorman",
                motor_designation=common,
                motor_id=None,
                url=f"{CTI_URL}#{slug}",
                sku=None,
                price_cents=price_to_cents(price_m.group(1)),
                currency="USD",
                status=status,
                stock_count=count,
                raw_title=line,  # the matcher runs infer_cti_propellant on this
                manufacturer=CESARONI_MANUFACTURER,
                diameter_mm=diameter,
                seen_at=seen_at,
            )
        )
    return out
