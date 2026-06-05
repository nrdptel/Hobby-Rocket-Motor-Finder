"""Snapshot resilience: carry a vendor's last-good listings forward when a fresh
scrape comes back degraded.

The hourly job rebuilds the catalog + scrapes all vendors from scratch each run.
Some vendors (notably AMW and Sirius) intermittently return 0 listings when hit
from CI data-center IPs. Without protection, that either (a) publishes a snapshot
where those vendors' motors vanish, or (b) fails the whole run so NO fresh data
publishes — including healthy vendors and new manufacturers.

``carry_forward`` fixes both: for any vendor whose fresh listing count is below a
floor (``carried``), it KEEPS whatever fresh listings that vendor did return and
BACKFILLS from the previous committed snapshot only the listings (by URL) the
fresh scrape is missing. So a fully-blocked vendor (0 fresh) republishes its
last-good data wholesale, while a *partial* scrape (e.g. a few category pages
timed out) keeps all the current data it got and only backfills the gaps —
instead of being rolled all the way back to stale data. Healthy vendors always
use fresh data. A vendor is reported ``failed`` only when it's below floor AND
there is no prior data to fall back on (so the caller can flag a brand-new or
chronically-broken vendor), but that no longer blocks publishing the rest.

Pure functions over snapshot dicts (the shape ``cli.snapshot_export`` writes):
no DB, no network, trivially testable.
"""
from __future__ import annotations

from collections import defaultdict

# Decision outcomes per vendor.
HEALTHY = "healthy"   # fresh scrape met the floor — use fresh data
CARRIED = "carried"   # fresh below floor — reuse last-good from the prev snapshot
FAILED = "failed"     # fresh below floor AND no prior data — nothing to publish


def vendor_counts(snapshot: dict) -> dict[str, int]:
    """Count matched listings per vendor slug in a snapshot."""
    counts: dict[str, int] = defaultdict(int)
    for m in snapshot.get("motors", []):
        for l in m.get("listings", []):
            counts[l["vendor_slug"]] += 1
    return dict(counts)


def _motor_key(motor: dict) -> tuple[str, str]:
    # Manufacturer + designation is stable across runs; motor ``id`` is not
    # (the DB is rebuilt every run), so never key carry-forward on id.
    return (motor["manufacturer"], motor["designation"])


def carry_forward(
    fresh: dict,
    prev: dict | None,
    floor: int,
    vendor_floors: dict[str, int] | None = None,
) -> tuple[dict, dict]:
    """Merge ``fresh`` with last-good data from ``prev`` for degraded vendors.

    A vendor is degraded when its fresh listing count is < its floor. Degraded
    vendors reuse their ``prev`` listings if available (``carried``), else they
    are reported ``failed``. Healthy vendors always use fresh data.

    ``floor`` is the default applied to every vendor; ``vendor_floors`` overrides
    it per-vendor slug. The override exists for small-catalog vendors (e.g. Loki
    has only ~60 reloads) that would otherwise sit permanently below the global
    floor sized for the big AeroTech/CTI vendors.

    Returns ``(merged_snapshot, report)``. ``report`` carries the per-vendor
    decision and counts; ``report["failed"]`` lists vendors with no fallback so
    the caller can decide to refuse publishing.
    """
    prev = prev or {"motors": [], "unmatched": []}
    vendor_floors = vendor_floors or {}
    fresh_counts = vendor_counts(fresh)
    prev_counts = vendor_counts(prev)

    decision: dict[str, str] = {}
    for vendor in set(fresh_counts) | set(prev_counts):
        vfloor = vendor_floors.get(vendor, floor)
        if fresh_counts.get(vendor, 0) >= vfloor:
            decision[vendor] = HEALTHY
        elif prev_counts.get(vendor, 0) > 0:
            decision[vendor] = CARRIED
        else:
            decision[vendor] = FAILED

    carried_vendors = {v for v, d in decision.items() if d == CARRIED}

    # Motor metadata by stable key. Prev first so fresh (more current) wins on
    # any overlap — keeps a carried-only motor's record available, too.
    meta: dict[tuple[str, str], dict] = {}
    for snap in (prev, fresh):
        for m in snap.get("motors", []):
            meta[_motor_key(m)] = {k: v for k, v in m.items() if k != "listings"}

    # URLs a carried vendor returned THIS run, so we backfill only the gaps from
    # prev (keep all fresh data; don't roll a partial scrape back to stale).
    fresh_urls: dict[str, set[str]] = defaultdict(set)
    for m in fresh.get("motors", []):
        for l in m.get("listings", []):
            fresh_urls[l["vendor_slug"]].add(l["url"])

    listings_by_motor: dict[tuple[str, str], list[dict]] = defaultdict(list)
    # Keep ALL fresh listings — healthy and carried (partially-degraded) vendors alike.
    for m in fresh.get("motors", []):
        key = _motor_key(m)
        for l in m.get("listings", []):
            listings_by_motor[key].append(l)
    # Backfill carried vendors from prev for listings the fresh scrape is missing.
    for m in prev.get("motors", []):
        key = _motor_key(m)
        for l in m.get("listings", []):
            v = l["vendor_slug"]
            if v in carried_vendors and l["url"] not in fresh_urls[v]:
                listings_by_motor[key].append(l)

    motors_out = []
    for key, listings in listings_by_motor.items():
        base = meta.get(key)
        if base is None or not listings:
            continue
        motors_out.append({**base, "listings": listings})
    # Mirror cli export ordering: impulse_class, then designation.
    motors_out.sort(key=lambda m: (m.get("impulse_class") or "", m.get("designation") or ""))

    # Unmatched follows the same keep-fresh-plus-backfill rule.
    fresh_unmatched_urls: dict[str, set[str]] = defaultdict(set)
    for u in fresh.get("unmatched", []):
        fresh_unmatched_urls[u["vendor_slug"]].add(u["url"])
    unmatched_out = list(fresh.get("unmatched", []))
    unmatched_out += [
        u
        for u in prev.get("unmatched", [])
        if u["vendor_slug"] in carried_vendors
        and u["url"] not in fresh_unmatched_urls[u["vendor_slug"]]
    ]

    merged = {
        "generated_at": fresh.get("generated_at"),
        "motors": motors_out,
        "unmatched": unmatched_out,
    }
    report = {
        "decision": decision,
        "fresh_counts": fresh_counts,
        "prev_counts": prev_counts,
        "failed": sorted(v for v, d in decision.items() if d == FAILED),
        "carried": sorted(v for v, d in decision.items() if d == CARRIED),
    }
    return merged, report
