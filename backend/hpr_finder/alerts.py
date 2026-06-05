"""Compute which motors *restocked* between two snapshots, for email alerts.

The hourly scrape calls ``hpr alerts dispatch`` (see cli.py), which diffs the
previously-published snapshot against the freshly-written one and POSTs the
restocked motors to the frontend's ``/api/alerts/dispatch`` route. All the
subscriber/email logic lives in TypeScript on Vercel; this module is just the
pure "what came back in stock" diff.
"""
from __future__ import annotations

_IN_STOCK = {"in_stock", "in_stock_with_count"}


def restocked_motors(prev: dict, current: dict) -> list[dict]:
    """Motors with a listing that transitioned out-of-stock → in-stock.

    A motor counts as restocked when one of its listings is in stock *now* and
    that same listing URL existed in ``prev`` and was *not* in stock there. We
    require the URL to have existed before so a brand-new listing/vendor (or a
    first run) doesn't flood alerts — only genuine comebacks fire. Carry-forward
    republishes identical statuses, so carried vendors never trigger a false
    restock.

    Returns one ``{manufacturer, designation, common_name}`` dict per restocked
    motor (deduped, input order preserved).
    """
    prev_status: dict[str, str] = {}
    for m in prev.get("motors", []):
        for listing in m.get("listings", []):
            url = listing.get("url")
            if url:
                prev_status[url] = listing.get("status", "")

    restocked: dict[tuple[str, str], dict] = {}
    for m in current.get("motors", []):
        manufacturer = m.get("manufacturer")
        designation = m.get("designation")
        if not manufacturer or not designation:
            continue
        key = (manufacturer, designation)
        if key in restocked:
            continue
        for listing in m.get("listings", []):
            if listing.get("status") not in _IN_STOCK:
                continue
            ps = prev_status.get(listing.get("url"))
            if ps is not None and ps not in _IN_STOCK:
                restocked[key] = {
                    "manufacturer": manufacturer,
                    "designation": designation,
                    "common_name": m.get("common_name"),
                }
                break
    return list(restocked.values())
