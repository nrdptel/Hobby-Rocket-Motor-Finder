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

    Returns one dict per restocked motor (deduped, input order preserved) with
    ``manufacturer``, ``designation``, ``common_name`` and the fit-relevant specs
    ``diameter_mm``, ``impulse_class``, ``total_impulse_ns``, ``case_info`` and
    ``motor_type`` — which let the dispatch route evaluate rocket-fit alerts
    ("anything that fits my rocket", now narrowable by class and reload case).
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
                restocked[key] = _motor_payload(m)
                break
    return list(restocked.values())


def _motor_payload(m: dict) -> dict:
    """The fit-relevant fields the dispatch route needs (per-motor + rocket-fit)."""
    return {
        "manufacturer": m.get("manufacturer"),
        "designation": m.get("designation"),
        "common_name": m.get("common_name"),
        "diameter_mm": m.get("diameter_mm"),
        "impulse_class": m.get("impulse_class"),
        "total_impulse_ns": m.get("total_impulse_ns"),
        "case_info": m.get("case_info"),
        "motor_type": m.get("motor_type"),
    }


def newly_available_motors(prev: dict, current: dict) -> list[dict]:
    """Motors appearing in stock for the FIRST time: in stock in ``current`` but
    absent from ``prev`` entirely (no listing at all).

    This is the "phantom" case — a real catalog motor no vendor stocked, now
    listed — which :func:`restocked_motors` deliberately ignores (it requires a
    prior out-of-stock listing on the same URL). The two are complementary and
    mutually exclusive: restocked = a known listing came back; newly-available =
    a motor we'd never seen listed shows up. Each result is tagged
    ``first_available: True`` so the dispatch can use first-appearance copy.

    Guarded against an empty/first-run ``prev`` (which would otherwise flag the
    entire catalog as "new" and flood every subscriber).
    """
    prev_keys = {
        (m.get("manufacturer"), m.get("designation"))
        for m in prev.get("motors", [])
        if m.get("manufacturer") and m.get("designation")
    }
    if not prev_keys:
        return []  # no baseline → can't tell what's genuinely new; never flood

    out: dict[tuple[str, str], dict] = {}
    for m in current.get("motors", []):
        manufacturer = m.get("manufacturer")
        designation = m.get("designation")
        if not manufacturer or not designation:
            continue
        key = (manufacturer, designation)
        if key in prev_keys or key in out:
            continue
        if any(listing.get("status") in _IN_STOCK for listing in m.get("listings", [])):
            out[key] = {**_motor_payload(m), "first_available": True}
    return list(out.values())
