"""Per-listing stock/price history derived from successive snapshots.

Pure functions over snapshot dicts and a history "log" dict — no git, no
network, no filesystem (the CLI layer owns those). Mirrors the style of
``snapshot.py``.

A snapshot is the shape ``cli.snapshot_export`` writes::

    {generated_at, motors: [{..., listings: [Listing]}], unmatched: [Listing]}

where a Listing carries ``url``, ``vendor_slug``, ``status``, ``price_cents``,
``seen_at``. Listing identity across snapshots is the ``url`` (verified unique
and stable; ``vendor_slug``+``sku`` is not).

The log records, per url, a *change-only* chronological event list::

    {version, updated_at, listings: {url: {vendor_slug, events: [{t, status, price_cents}]}}}

An event is appended only when ``(status, price_cents)`` differs from the
listing's last event — so a carry-forward blip (an identical, re-published
listing) records nothing.
"""
from __future__ import annotations

from collections.abc import Iterable, Iterator
from datetime import UTC, datetime, timedelta
from functools import reduce

LOG_VERSION = 1

# The two enum values that count as "in stock". Defining this once is what makes
# a flip between in_stock and in_stock_with_count a recorded event but NOT a
# restock (restock keys on this normalized boolean, not the raw status).
IN_STOCK_STATUSES = frozenset({"in_stock", "in_stock_with_count"})


def is_in_stock(status: str | None) -> bool:
    """True iff ``status`` is one of the two in-stock enum values."""
    return status in IN_STOCK_STATUSES


def empty_log() -> dict:
    return {"version": LOG_VERSION, "updated_at": None, "listings": {}}


def _all_listings(snapshot: dict) -> Iterator[dict]:
    for m in snapshot.get("motors", []):
        yield from m.get("listings", [])
    yield from snapshot.get("unmatched", [])


def _parse(t: str | None) -> datetime | None:
    """Parse an ISO8601 timestamp, normalized to UTC-aware. Early snapshots in the
    history have tz-naive timestamps; treat those as UTC so comparisons across the
    whole archive never mix naive and aware datetimes."""
    try:
        dt = datetime.fromisoformat(t) if t else None
    except (TypeError, ValueError):
        return None
    if dt is not None and dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def listing_state(snapshot: dict) -> dict[str, dict]:
    """Flatten a snapshot into ``{url: {status, price_cents, seen_at, vendor_slug}}``.

    ``seen_at`` falls back to the snapshot's ``generated_at``. Last write wins on
    the (guaranteed-rare) duplicate url.
    """
    gen = snapshot.get("generated_at")
    state: dict[str, dict] = {}
    for listing in _all_listings(snapshot):
        url = listing.get("url")
        if not url:
            continue
        state[url] = {
            "status": listing.get("status"),
            "price_cents": listing.get("price_cents"),
            "seen_at": listing.get("seen_at") or gen,
            "vendor_slug": listing.get("vendor_slug"),
        }
    return state


def apply_snapshot(log: dict, snapshot: dict) -> dict:
    """Return a NEW log with a change-only event appended for each listing whose
    ``(status, price_cents)`` differs from its last recorded event.

    First-seen listings get an initial event. Listings absent from this snapshot
    are left untouched (no delist events). Idempotent: re-applying the same
    snapshot appends nothing. ``updated_at`` becomes the snapshot's generated_at.
    """
    # Deep-enough copy so we never mutate the input log's event lists.
    listings: dict[str, dict] = {
        url: {**entry, "events": list(entry.get("events", []))}
        for url, entry in log.get("listings", {}).items()
    }

    for url, st in listing_state(snapshot).items():
        event = {"t": st["seen_at"], "status": st["status"], "price_cents": st["price_cents"]}
        entry = listings.get(url)
        if entry is None:
            listings[url] = {"vendor_slug": st["vendor_slug"], "events": [event]}
            continue
        events = entry["events"]
        last = events[-1] if events else None
        if last is None or (last["status"], last["price_cents"]) != (st["status"], st["price_cents"]):
            events.append(event)
        # Keep vendor_slug fresh (cheap, and harmless when unchanged).
        entry["vendor_slug"] = st["vendor_slug"] or entry.get("vendor_slug")

    return {
        "version": LOG_VERSION,
        "updated_at": snapshot.get("generated_at") or log.get("updated_at"),
        "listings": listings,
    }


def backfill(snapshots: Iterable[dict]) -> dict:
    """Fold :func:`apply_snapshot` over an oldest->newest iterable of snapshots.

    The caller supplies the ordering and the dicts (git lives in the CLI). A
    generator works fine — we never hold every snapshot in memory at once.
    """
    return reduce(apply_snapshot, snapshots, empty_log())


def prune(log: dict, now: str, window_days: int) -> dict:
    """Return a NEW log dropping events older than ``now - window_days``, but
    ALWAYS keep each listing's most recent event so current state survives a long
    quiet stretch. A listing with no events is dropped.
    """
    cutoff = _parse(now)
    if cutoff is not None:
        cutoff = cutoff - timedelta(days=window_days)
    listings: dict[str, dict] = {}
    for url, entry in log.get("listings", {}).items():
        events = entry.get("events", [])
        if not events:
            continue
        if cutoff is None:
            kept = list(events)
        else:
            # Unparseable timestamps are conservatively kept (treated as recent).
            kept = [e for e in events if (_parse(e["t"]) or cutoff) >= cutoff]
            if not kept:
                kept = [events[-1]]  # events are append-ordered, so [-1] is newest
        listings[url] = {**entry, "events": kept}
    return {**log, "listings": listings}


def summarize(log: dict, now: str, price_window_days: int = 30) -> dict:
    """Derive the compact per-url summary the frontend loads.

    ``price_low_cents`` / ``price_high_cents`` span ``price_window_days`` (the
    current price is always included). A restock is a genuine *observed*
    out-of-stock -> in-stock transition (the previous event was explicitly
    not-in-stock); a listing's first-ever appearance is NEVER a restock, even if
    it is in-stock — we don't know its prior state, and counting it would label
    every continuously-stocked listing "restocked" at the start of tracking.
    ``now`` is an ISO8601 string.
    """
    cutoff = _parse(now)
    if cutoff is not None:
        cutoff = cutoff - timedelta(days=price_window_days)

    out: dict[str, dict] = {}
    for url, entry in log.get("listings", {}).items():
        events = entry.get("events", [])
        if not events:
            continue
        last = events[-1]

        restocks: list[str] = []
        last_in_stock_at: str | None = None
        prev_in: bool | None = None
        for e in events:
            ins = is_in_stock(e["status"])
            if ins:
                last_in_stock_at = e["t"]
                if prev_in is False:  # genuine out-of-stock -> in-stock (not first-seen)
                    restocks.append(e["t"])
            prev_in = ins

        price_current = last["price_cents"]
        price_prev: int | None = None
        if price_current is not None:
            for e in reversed(events[:-1]):
                p = e["price_cents"]
                if p is not None and p != price_current:
                    price_prev = p
                    break

        window_prices = [
            e["price_cents"]
            for e in events
            if e["price_cents"] is not None and (cutoff is None or (_parse(e["t"]) or cutoff) >= cutoff)
        ]
        if price_current is not None:
            window_prices.append(price_current)

        out[url] = {
            "currently_in_stock": is_in_stock(last["status"]),
            "status_current": last["status"],
            "first_seen_at": events[0]["t"],
            "last_change_at": last["t"],
            "last_in_stock_at": last_in_stock_at,
            "last_restock_at": restocks[-1] if restocks else None,
            "restock_count": len(restocks),
            "price_current_cents": price_current,
            "price_prev_cents": price_prev,
            "price_low_cents": min(window_prices) if window_prices else None,
            "price_high_cents": max(window_prices) if window_prices else None,
        }
    return out
