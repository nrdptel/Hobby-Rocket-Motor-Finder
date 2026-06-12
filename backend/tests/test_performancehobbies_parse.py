"""Parse-level tests for the Performance Hobbies scraper.

PH is a tree of ASP ``store.aspx?groupid=`` pages: branch pages list subgroups,
leaf pages render products as ``<tr>`` rows (no per-product detail pages). The
fixtures are live pages captured 2026-06: three branch pages (to exercise
subgroup discovery + the hardware/out-of-scope skip filter) and one product leaf
per manufacturer (AeroTech / Cesaroni / Loki) covering both in-stock and
out-of-stock rows.
"""
from pathlib import Path

import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.performancehobbies import (
    _SKIP_NAME_RE,
    GROUP_URL,
    NAV_GROUP_IDS,
    ROOTS,
    PerformanceHobbiesScraper,
    _classify_status,
    _crawl,
    extract_subgroups,
    parse_diameter,
    parse_products,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    # The scraper decodes the (mis-declared utf-8) body as latin-1; mirror that.
    return (FIXTURES / name).read_text(encoding="latin-1")


def _by_designation(listings, desig):
    return next(l for l in listings if l.motor_designation == desig)


# --- AeroTech leaf -----------------------------------------------------------

def test_aerotech_leaf_parses_clean_designations():
    url = GROUP_URL + "9134"
    listings = parse_products(_load("performancehobbies_leaf_aerotech_38mm.html"), url, "AeroTech", 38)
    assert len(listings) >= 40
    assert all(l.manufacturer == "AeroTech" for l in listings)
    assert all(l.vendor_slug == "performancehobbies" for l in listings)
    assert all(l.motor_designation for l in listings)
    # Every product gets a stable, unique URL even with no per-product page.
    assert len({l.url for l in listings}) == len(listings)


def test_aerotech_in_stock_row_fields():
    url = GROUP_URL + "9134"
    listing = _by_designation(
        parse_products(_load("performancehobbies_leaf_aerotech_38mm.html"), url, "AeroTech", 38),
        "J570W-14A",
    )
    assert listing.status == StockStatus.IN_STOCK
    assert listing.price_cents == 11399  # $113.99
    assert listing.sku == "9135"  # productid from the add-to-cart link
    assert listing.url == GROUP_URL + "9134#J570W-14A"
    assert listing.stock_count is None  # PH never publishes counts


def test_aerotech_out_of_stock_row():
    url = GROUP_URL + "9134"
    listing = _by_designation(
        parse_products(_load("performancehobbies_leaf_aerotech_38mm.html"), url, "AeroTech", 38),
        "H123W-14A",
    )
    assert listing.status == StockStatus.OUT_OF_STOCK
    assert listing.sku is None  # no productid when out of stock
    assert listing.price_cents == 4499


# --- Cesaroni leaf -----------------------------------------------------------

def test_cesaroni_leaf_extracts_commonname_flavor_diameter():
    url = GROUP_URL + "32902113819491"
    listings = parse_products(_load("performancehobbies_leaf_cesaroni_pro38.html"), url, "Cesaroni Technology", 38)
    assert len(listings) >= 40
    assert all(l.manufacturer == "Cesaroni Technology" for l in listings)
    # CTI matcher needs the diameter (collision-breaker); it comes from the group.
    assert all(l.diameter_mm == 38 for l in listings)
    # "White Thunder 4 grain 540-I470-15A" -> commonName I470, raw title kept for
    # flavor inference downstream.
    listing = _by_designation(listings, "I470")
    assert listing.status == StockStatus.IN_STOCK
    assert "White Thunder" in listing.raw_title
    assert listing.price_cents == 8046


# --- Loki leaf ---------------------------------------------------------------

def test_loki_leaf_normalizes_designations():
    url = GROUP_URL + "105200411250931"
    listings = parse_products(_load("performancehobbies_leaf_loki_reloads.html"), url, "Loki Research", None)
    assert len(listings) >= 40
    assert all(l.manufacturer == "Loki Research" for l in listings)
    desigs = {l.motor_designation for l in listings}
    assert "K350" in desigs  # "K350 White Reload"
    assert "N3800" in desigs  # "N-3800 White Reload" -> leading hyphen collapsed
    k350 = _by_designation(listings, "K350")
    assert k350.status == StockStatus.IN_STOCK
    assert k350.price_cents == 26000


# --- branch pages: subgroup discovery + skip filter --------------------------

def test_subgroup_discovery_skips_nav_and_breadcrumbs():
    subs = extract_subgroups(_load("performancehobbies_branch_aerotech_reloads.html"))
    ids = {gid for gid, _ in subs}
    # The per-diameter motor groups are discovered...
    assert len(subs) >= 7
    # ...but the global nav menu (rendered as bare <a>, not <li>) never is.
    assert not (ids & NAV_GROUP_IDS)


def test_skip_filter_drops_hardware_and_out_of_scope_brands():
    subs = extract_subgroups(_load("performancehobbies_branch_cesaroni.html"))
    kept = [name for _, name in subs if not _SKIP_NAME_RE.search(name)]
    skipped = [name for _, name in subs if _SKIP_NAME_RE.search(name)]
    # Reload-kit (motor) groups survive; hardware and AMW-brand groups are pruned.
    assert any("RELOAD KITS" in n.upper() for n in kept)
    assert all("HARDWARE" not in n.upper() for n in kept)
    assert any("HARDWARE" in n.upper() for n in skipped)
    assert any("AMW" in n.upper() for n in skipped)


def test_branch_root_featured_non_motor_rows_are_skipped():
    # The AeroTech root page shows a few featured accessories (seal disks, igniter
    # clips) with no motor designation — they must not become listings.
    url = GROUP_URL + "2180210303839"
    listings = parse_products(_load("performancehobbies_branch_aerotech_top.html"), url, "AeroTech", None)
    assert listings == []


def test_parse_diameter():
    assert parse_diameter("PRO38 RELOAD KITS") == 38
    assert parse_diameter("54MM MOTORS") == 54
    assert parse_diameter("Pro98 Reload Kits") == 98
    assert parse_diameter("RELOADS") is None


def test_classify_status():
    assert _classify_status("anything", in_stock=True) == StockStatus.IN_STOCK
    assert _classify_status("<td>Out of stock</td>", in_stock=False) == StockStatus.OUT_OF_STOCK
    assert _classify_status("Call for availability", in_stock=False) == StockStatus.SPECIAL_ORDER
    assert _classify_status("mystery", in_stock=False) == StockStatus.UNKNOWN


# --- scrape() + _crawl group-tree walk ---------------------------------------


class _FakeResp:
    def __init__(self, body: str):
        # _crawl decodes r.content as latin-1 (the site mis-declares utf-8).
        self.content = body.encode("latin-1")

    def raise_for_status(self):
        return None


class _CrawlClient:
    """Each brand ROOT serves the branch page (which links sub-groups); every
    other group id serves the leaf page (products, no further sub-groups, so the
    depth-first walk terminates)."""

    def __init__(self, branch_html: str, leaf_html: str):
        self._branch = branch_html
        self._leaf = leaf_html
        self._roots = {r[0] for r in ROOTS}

    async def get(self, url, **kwargs):
        group_id = url.split("groupid=")[-1]
        return _FakeResp(self._branch if group_id in self._roots else self._leaf)


def _crawl_client():
    return _CrawlClient(
        _load("performancehobbies_branch_aerotech_top.html"),
        _load("performancehobbies_leaf_aerotech_38mm.html"),
    )


@pytest.mark.asyncio
async def test_scrape_walks_roots_and_subgroups():
    listings = await PerformanceHobbiesScraper().scrape(_crawl_client())
    assert len(listings) > 0
    assert all("groupid=" in l.url for l in listings)


@pytest.mark.asyncio
async def test_scrape_respects_limit():
    listings = await PerformanceHobbiesScraper().scrape(_crawl_client(), limit=1)
    assert len(listings) == 1


@pytest.mark.asyncio
async def test_scrape_only_urls_filters_to_requested():
    everything = await PerformanceHobbiesScraper().scrape(_crawl_client())
    target = everything[0].url
    filtered = await PerformanceHobbiesScraper().scrape(_crawl_client(), only_urls=[target])
    assert filtered and all(l.url == target for l in filtered)


@pytest.mark.asyncio
async def test_crawl_skips_an_already_visited_group():
    out: list = []
    # group_id already in `visited` -> immediate return, no fetch.
    await _crawl(_crawl_client(), "999", "AeroTech", None, {"999"}, out, None)
    assert out == []


@pytest.mark.asyncio
async def test_crawl_returns_when_limit_already_reached():
    out: list = ["sentinel"]  # already at the limit
    await _crawl(_crawl_client(), "777", "AeroTech", None, set(), out, 1)
    assert out == ["sentinel"]  # returned before fetching/parsing
