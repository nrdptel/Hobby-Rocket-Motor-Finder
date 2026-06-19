"""Parse-level tests for the Motorman Rocketry scraper (Weebly, two flat pages).

Fixtures mirror the real page shape: products are ``<br>``-separated lines inside
``<div class="paragraph">`` blocks, ``$price`` followed by an optional
``<strong> (qty)</strong>`` stock count; CTI reloads are grouped under red
``Pro<NN> Hardware and Reloads:`` headers that establish the diameter.
"""
import pytest

from hpr_finder.models import StockStatus
from hpr_finder.scrapers.motorman import (
    MotormanScraper,
    _status,
    parse_aerotech,
    parse_cti,
)

AT_HTML = (
    '<div class="paragraph"><font>'
    "H283ST-15A&nbsp;&nbsp; $54.99<strong>&nbsp; (2)</strong><br />"
    "H135W-14A&nbsp;&nbsp; $46.99<br />"  # no (qty) -> out of stock
    "I205W-14A&nbsp;&nbsp; $63.99<strong> (1)</strong><br />"
    "C12-4FJ&nbsp;&nbsp; $12.99<strong> (3)</strong><br />"  # sub-D model motor -> dropped
    "RMS-29/40-120 Casing&nbsp;&nbsp; $45.00<strong> (4)</strong>"  # hardware -> dropped
    "</font></div>"
)

CTI_HTML = (
    '<div class="paragraph"><font color="#a82e2e"><strong>Pro38 Hardware and Reloads:</strong></font></div>'
    '<div class="paragraph"><font>'
    "1 Grain Casing P38-1G&nbsp;&nbsp; $30.00<strong> (5)</strong><br />"  # casing -> dropped
    "3G Reload 142 H160 -13A&nbsp;&nbsp; $34.30<strong> (2)</strong><br />"
    "6G Reload 312 J360 -16A&nbsp;&nbsp; $60.00"  # no qty -> out of stock
    "</font></div>"
    '<div class="paragraph"><font color="#a82e2e"><strong>Pro54 Hardware and Reloads:</strong></font></div>'
    '<div class="paragraph"><font>'
    "3G Reload 654 K660 -16A White Thunder&nbsp;&nbsp; $90.00<strong> (1)</strong>"
    "</font></div>"
)


def test_status_mapping():
    assert _status("2") == (StockStatus.IN_STOCK_WITH_COUNT, 2)
    assert _status("0") == (StockStatus.OUT_OF_STOCK, None)
    assert _status(None) == (StockStatus.OUT_OF_STOCK, None)


def test_parse_aerotech_basic():
    out = parse_aerotech(AT_HTML)
    by_des = {l.motor_designation: l for l in out}
    # In-scope motors only: sub-D model motor and the casing are dropped.
    assert set(by_des) == {"H283ST-15A", "H135W-14A", "I205W-14A"}
    h = by_des["H283ST-15A"]
    assert h.vendor_slug == "motorman"
    assert h.manufacturer == "AeroTech"
    assert h.status is StockStatus.IN_STOCK_WITH_COUNT and h.stock_count == 2
    assert h.price_cents == 5499
    assert h.url == "https://www.the-motorman.net/aerotech.html#h283st-15a-54-99-2"
    # No (qty) marker => out of stock, no count.
    assert by_des["H135W-14A"].status is StockStatus.OUT_OF_STOCK
    assert by_des["H135W-14A"].stock_count is None


def test_parse_aerotech_drops_subD_and_hardware():
    out = parse_aerotech(AT_HTML)
    designations = {l.motor_designation for l in out}
    assert "C12-4FJ" not in designations  # sub-D
    assert not any("Casing" in l.raw_title and l.motor_designation.startswith("RMS") for l in out)


def test_parse_cti_tracks_diameter_and_flavor():
    out = parse_cti(CTI_HTML)
    by_common = {l.motor_designation: l for l in out}
    # Casing under Pro38 is dropped; three reloads remain.
    assert set(by_common) == {"H160", "J360", "K660"}
    for l in out:
        assert l.manufacturer == "Cesaroni Technology"
    # Diameter comes from the section header the reload sits under.
    assert by_common["H160"].diameter_mm == 38
    assert by_common["J360"].diameter_mm == 38
    assert by_common["K660"].diameter_mm == 54
    # Stock counts.
    assert by_common["H160"].status is StockStatus.IN_STOCK_WITH_COUNT and by_common["H160"].stock_count == 2
    assert by_common["J360"].status is StockStatus.OUT_OF_STOCK  # no (qty)
    assert by_common["K660"].stock_count == 1
    # The full line is kept as raw_title so the matcher can read the flavor.
    assert "White Thunder" in by_common["K660"].raw_title
    assert by_common["H160"].price_cents == 3430


def test_parse_cti_drops_casings():
    out = parse_cti(CTI_HTML)
    assert all("Casing" not in l.raw_title for l in out)


# --- scrape() orchestration ---------------------------------------------------


class _FakeResp:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        return None


class _TwoPageClient:
    def __init__(self, fail_substr=None):
        self.fail = fail_substr

    async def get(self, url, **kwargs):
        if self.fail and self.fail in url:
            raise RuntimeError("page down")
        return _FakeResp(AT_HTML if "aerotech" in url else CTI_HTML)


@pytest.mark.asyncio
async def test_scrape_fetches_both_pages():
    out = await MotormanScraper().scrape(_TwoPageClient())
    mfrs = {l.manufacturer for l in out}
    assert mfrs == {"AeroTech", "Cesaroni Technology"}
    assert len(out) == 3 + 3  # 3 AeroTech + 3 CTI


@pytest.mark.asyncio
async def test_scrape_isolates_a_failing_page():
    # If the CTI page is down, the AeroTech listings still come back (and vice
    # versa) — the floor/carry-forward handles the missing half.
    out = await MotormanScraper().scrape(_TwoPageClient(fail_substr="cti"))
    assert {l.manufacturer for l in out} == {"AeroTech"}
    assert len(out) == 3


@pytest.mark.asyncio
async def test_scrape_honors_limit():
    out = await MotormanScraper().scrape(_TwoPageClient(), limit=2)
    assert len(out) == 2
