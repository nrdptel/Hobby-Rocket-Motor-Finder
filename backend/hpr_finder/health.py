"""Baseline-relative scrape health: catch a vendor whose fresh scrape is quietly
degraded even though it cleared the carry-forward floor.

``carry_forward`` + the staleness alerter already cover the loud failures: a
vendor that returns almost nothing (near-total failure, below floor) carries its
last-good data forward, and a sustained outage (carried data going stale) opens a
tracking issue. They miss two QUIET failure modes:

  1. Partial degradation — a vendor that normally returns ~600 listings now
     returns 300. It's above the floor, reported "healthy", but half its catalog
     silently vanished.
  2. In-stock collapse — a parsing regression returns the normal listing COUNT
     but flips (almost) everything to out-of-stock. The data is FRESH (stale-hours
     ~0) and above floor, so nothing fires — yet the site shows that vendor as
     sold out across the board. (Same class as the historical "0 in stock" bugs.)

This module tracks a slow EWMA baseline of each vendor's fresh listing count and
fresh in-stock count, and flags a vendor when the current run falls well below
its own baseline. The baseline only moves on runs where the vendor is healthy AND
not already anomalous, so a gradual break can't drag the baseline down to match it
(no boiling-frog). A per-vendor consecutive-anomaly streak gates escalation so a
single slow run doesn't cry wolf.

Pure functions over plain dicts — no DB, no network, no clock — so they're
trivially testable. The caller (cli.snapshot_export) supplies timestamps.
"""
from __future__ import annotations

from collections import defaultdict

# Statuses that count as "in stock" — must match alerts._IN_STOCK and the
# frontend's listingInStock so the baseline reflects what users actually see.
IN_STOCK = {"in_stock", "in_stock_with_count"}

# Tuning. Conservative on purpose: only escalate on a real, sustained dip.
DEFAULTS: dict[str, float] = {
    "alpha": 0.25,            # EWMA weight on the newest observation
    "min_samples": 5,         # need this many healthy observations before judging
    "count_ratio": 0.5,       # listings below 50% of baseline = anomalous
    "stock_ratio": 0.34,      # in-stock below ~1/3 of baseline = anomalous
    "min_stock_baseline": 5,  # don't in-stock-check vendors that rarely have stock
    "streak_to_alert": 3,     # consecutive anomalous runs before escalating
    # Match-rate erosion: a normalizer regression leaves a chunk of a vendor's
    # catalog UNMATCHED. Matched count can dip under count_ratio without firing
    # while unmatched spikes — so we watch unmatched too. Direction is inverted
    # (anomalous when current >> baseline) with a dual floor to mute tiny vendors.
    "unmatched_spike_ratio": 2.0,   # unmatched above 2x baseline = anomalous
    "min_unmatched_baseline": 8,    # ignore vendors whose unmatched baseline is tiny
    "min_unmatched_spike": 15,      # and require an absolute jump at least this big
    # Chronic degradation (see ``update_carry_window``). Sized for the hourly
    # scrape, so the window is about a day.
    "carry_window": 24,        # runs of carry/healthy history kept per vendor
    "chronic_min_window": 12,  # need this much history before judging
    "chronic_open": 5,         # carried in >= this many of the window → escalate
    "chronic_close": 2,        # ...and stays escalated until it falls to <= this
}


def vendor_stock_counts(snapshot: dict) -> dict[str, dict[str, int]]:
    """Per-vendor ``{"total", "in_stock"}`` listing counts in a snapshot."""
    out: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "in_stock": 0})
    for m in snapshot.get("motors", []):
        for listing in m.get("listings", []):
            v = listing.get("vendor_slug")
            if not v:
                continue
            out[v]["total"] += 1
            if listing.get("status") in IN_STOCK:
                out[v]["in_stock"] += 1
    return {k: dict(v) for k, v in out.items()}


def vendor_unmatched_counts(snapshot: dict) -> dict[str, int]:
    """Per-vendor count of UNMATCHED listings in a snapshot — the scraped products
    the normalizer couldn't map to a catalog motor (they live in ``snapshot
    ["unmatched"]``, NOT under ``motors``, so ``vendor_stock_counts`` never sees
    them). A spike here while the matched count holds steady is match-rate erosion:
    a vendor's listings silently vanishing from the user-facing view."""
    out: dict[str, int] = defaultdict(int)
    for u in snapshot.get("unmatched", []):
        v = u.get("vendor_slug")
        if v:
            out[v] += 1
    return dict(out)


def detect_anomalies(
    fresh: dict[str, dict[str, int]],
    baseline: dict[str, dict],
    decision: dict[str, str],
    cfg: dict[str, float] | None = None,
    fresh_unmatched: dict[str, int] | None = None,
) -> list[dict]:
    """Anomalous vendors for THIS run (streak not yet applied).

    Only HEALTHY vendors are judged — a carried/failed vendor is already covered
    by the floor/staleness path, and judging its degraded fresh data would double-
    alert. A vendor with too few baseline samples is skipped (still warming up).

    ``fresh_unmatched`` (per-vendor unmatched counts from ``vendor_unmatched_counts``)
    is optional so existing callers/tests keep working; when supplied, a vendor whose
    unmatched count spikes well above its own baseline is flagged too.
    """
    cfg = {**DEFAULTS, **(cfg or {})}
    fresh_unmatched = fresh_unmatched or {}
    anomalies: list[dict] = []
    # Union of keys: a vendor can appear in only one of the two maps (e.g. all of
    # its listings unmatched this run). Default the missing side to zero.
    for vendor in sorted(set(fresh) | set(fresh_unmatched)):
        if decision.get(vendor) != "healthy":
            continue
        b = baseline.get(vendor)
        if not b or b.get("samples", 0) < cfg["min_samples"]:
            continue
        cur = fresh.get(vendor, {"total": 0, "in_stock": 0})
        cur_unmatched = fresh_unmatched.get(vendor, 0)
        reasons: list[str] = []
        if b.get("count", 0) > 0 and cur["total"] < b["count"] * cfg["count_ratio"]:
            reasons.append(f"listings {cur['total']} vs ~{round(b['count'])} baseline")
        if (
            b.get("stock", 0) >= cfg["min_stock_baseline"]
            and cur["in_stock"] < b["stock"] * cfg["stock_ratio"]
        ):
            reasons.append(f"in-stock {cur['in_stock']} vs ~{round(b['stock'])} baseline")
        # Unmatched spike. Gate on ``is None`` (not ``.get(..., 0)``): an un-migrated
        # baseline has no unmatched value yet, and a 0 default would flag every
        # spiking vendor on the first run before the metric has warmed up.
        bu = b.get("unmatched")
        if (
            bu is not None
            and bu >= cfg["min_unmatched_baseline"]
            and cur_unmatched > bu * cfg["unmatched_spike_ratio"]
            and cur_unmatched - bu >= cfg["min_unmatched_spike"]
        ):
            reasons.append(f"unmatched {cur_unmatched} vs ~{round(bu)} baseline")
        if reasons:
            anomalies.append(
                {
                    "vendor": vendor,
                    "reasons": reasons,
                    "total": cur["total"],
                    "in_stock": cur["in_stock"],
                    "unmatched": cur_unmatched,
                    "baseline_total": round(b.get("count", 0), 1),
                    "baseline_in_stock": round(b.get("stock", 0), 1),
                    "baseline_unmatched": round(bu, 1) if bu is not None else None,
                }
            )
    return anomalies


def update_baseline(
    baseline: dict[str, dict],
    fresh: dict[str, dict[str, int]],
    decision: dict[str, str],
    anomalies: list[dict],
    updated_at: str,
    cfg: dict[str, float] | None = None,
    fresh_unmatched: dict[str, int] | None = None,
) -> dict[str, dict]:
    """Return a NEW baseline. For a vendor healthy this run:
      - not anomalous → EWMA-update count/stock/unmatched, bump samples, reset streak.
      - anomalous     → leave count/stock/unmatched put (no boiling-frog), bump streak.
    Carried/failed vendors are left untouched (no fresh signal to learn from).

    ``fresh_unmatched`` is optional (existing callers/tests work unchanged). When a
    legacy baseline lacks the ``unmatched`` field, it is seeded from the current
    value on the first healthy run — independent of the count/stock ``samples``
    counter, so already-mature vendors gain the metric without resetting maturity.
    """
    cfg = {**DEFAULTS, **(cfg or {})}
    a = cfg["alpha"]
    fresh_unmatched = fresh_unmatched or {}
    anomalous = {x["vendor"] for x in anomalies}
    out = {k: dict(v) for k, v in baseline.items()}
    for vendor in set(fresh) | set(fresh_unmatched):
        if decision.get(vendor) != "healthy":
            continue
        cur = fresh.get(vendor, {"total": 0, "in_stock": 0})
        cur_unmatched = fresh_unmatched.get(vendor, 0)
        b = dict(out.get(vendor, {"count": 0.0, "stock": 0.0, "samples": 0, "streak": 0}))
        if vendor in anomalous:
            b["streak"] = int(b.get("streak", 0)) + 1
        else:
            n = int(b.get("samples", 0))
            if n == 0:
                b["count"] = float(cur["total"])
                b["stock"] = float(cur["in_stock"])
            else:
                b["count"] = a * cur["total"] + (1 - a) * float(b.get("count", 0))
                b["stock"] = a * cur["in_stock"] + (1 - a) * float(b.get("stock", 0))
            # Unmatched tracks its own seed (None → seed, else EWMA) so a legacy
            # baseline picks it up on the next healthy run without a reset.
            if b.get("unmatched") is None:
                b["unmatched"] = float(cur_unmatched)
            else:
                b["unmatched"] = a * cur_unmatched + (1 - a) * float(b["unmatched"])
            b["samples"] = n + 1
            b["streak"] = 0
        b["updated_at"] = updated_at
        out[vendor] = b
    return out


def sustained_anomalies(
    anomalies: list[dict],
    baseline: dict[str, dict],
    cfg: dict[str, float] | None = None,
) -> list[dict]:
    """The subset of this run's anomalies whose (post-update) streak has reached
    the escalation threshold. Each is annotated with its current ``streak``."""
    cfg = {**DEFAULTS, **(cfg or {})}
    out: list[dict] = []
    for an in anomalies:
        streak = int(baseline.get(an["vendor"], {}).get("streak", 0))
        annotated = {**an, "streak": streak}
        if streak >= cfg["streak_to_alert"]:
            out.append(annotated)
    return out


def update_carry_window(
    baseline: dict[str, dict],
    decision: dict[str, str],
    cfg: dict[str, float] | None = None,
) -> dict[str, dict]:
    """Return a NEW baseline with each vendor's rolling carry history advanced by
    this run, and its latched ``chronic`` flag re-evaluated.

    This is the CHRONIC-degradation signal, and it's deliberately the one piece of
    health state that records non-healthy runs. Everything else here learns only
    from healthy runs (see ``update_baseline``), and the staleness alerter only
    fires on ONE sustained outage — so a vendor that fails a fifth of its runs and
    recovers within a couple of hours each time is invisible to both: never stale
    long enough to escalate, never fresh enough to be judged against its baseline.
    That is exactly the shape of a vendor blocking the CI egress IP intermittently.

    ``carry_window`` outcomes are kept per vendor (1 = carried or failed, 0 =
    healthy), most recent last. The verdict is latched with hysteresis — it opens
    at ``chronic_open`` and only clears at ``chronic_close`` — so a vendor sitting
    near the threshold can't flap the tracking issue open and closed every hour.

    Vendors absent from ``decision`` keep their history untouched: a vendor
    dropped from the registry shouldn't have its record rewritten, and a run that
    never reached a vendor has no outcome to record.
    """
    cfg = {**DEFAULTS, **(cfg or {})}
    size = int(cfg["carry_window"])
    out = {k: dict(v) for k, v in baseline.items()}
    for vendor, d in decision.items():
        b = dict(out.get(vendor, {}))
        window = [int(x) for x in b.get("carry_window", [])][-size:]
        window.append(0 if d == "healthy" else 1)
        window = window[-size:]
        carried = sum(window)
        was_chronic = bool(b.get("chronic", False))
        if len(window) < int(cfg["chronic_min_window"]):
            # Not enough history to change the verdict either way.
            chronic = was_chronic
        elif carried >= int(cfg["chronic_open"]):
            chronic = True
        elif carried <= int(cfg["chronic_close"]):
            chronic = False
        else:
            chronic = was_chronic
        b["carry_window"] = window
        b["chronic"] = chronic
        out[vendor] = b
    return out


def chronic_vendors(
    baseline: dict[str, dict],
    cfg: dict[str, float] | None = None,
) -> list[dict]:
    """Vendors currently latched chronic, with the carry counts behind the verdict.
    Read AFTER ``update_carry_window`` so the numbers match this run."""
    cfg = {**DEFAULTS, **(cfg or {})}
    out: list[dict] = []
    for vendor in sorted(baseline):
        b = baseline[vendor]
        if not b.get("chronic"):
            continue
        window = [int(x) for x in b.get("carry_window", [])]
        out.append(
            {
                "vendor": vendor,
                "carried": sum(window),
                "window": len(window),
                "reason": (
                    f"degraded in {sum(window)} of the last {len(window)} runs "
                    f"(opens at {int(cfg['chronic_open'])}, clears at "
                    f"{int(cfg['chronic_close'])})"
                ),
            }
        )
    return out


def carry_rates(baseline: dict[str, dict]) -> dict[str, dict[str, int]]:
    """Per-vendor ``{"carried", "window"}`` from the rolling history — reported
    every run so the trend is visible before it crosses the threshold."""
    out: dict[str, dict[str, int]] = {}
    for vendor, b in baseline.items():
        window = [int(x) for x in b.get("carry_window", [])]
        if window:
            out[vendor] = {"carried": sum(window), "window": len(window)}
    return out


def annotate_streaks(anomalies: list[dict], baseline: dict[str, dict]) -> list[dict]:
    """Attach the post-update streak to each anomaly (for the report/summary)."""
    return [
        {**an, "streak": int(baseline.get(an["vendor"], {}).get("streak", 0))}
        for an in anomalies
    ]
