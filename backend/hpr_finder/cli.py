"""HPR Motor Finder CLI."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import httpx
import typer

from . import catalog, db, health, history
from .alerts import restocked_motors
from .http import USER_AGENT, polite_async_client
from .models import _utc_now
from .normalize import is_out_of_scope
from .scrapers import REGISTRY
from .snapshot import carry_forward, vendor_counts

app = typer.Typer(help="HPR motor availability aggregator CLI", no_args_is_help=True)
catalog_app = typer.Typer(help="Manage the canonical motor catalog")
scrape_app = typer.Typer(help="Run vendor scrapers")
snapshot_app = typer.Typer(help="Export the current state for the frontend")
history_app = typer.Typer(help="Maintain per-listing stock/price history")
alerts_app = typer.Typer(help="Trigger restock email alerts")
app.add_typer(catalog_app, name="catalog")
app.add_typer(scrape_app, name="scrape")
app.add_typer(snapshot_app, name="snapshot")
app.add_typer(history_app, name="history")
app.add_typer(alerts_app, name="alerts")

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_SNAPSHOT = _REPO_ROOT / "data" / "snapshot.json"
_DEFAULT_HISTORY_LOG = _REPO_ROOT / "data" / "history" / "log.json"
_DEFAULT_HISTORY_SUMMARY = _REPO_ROOT / "data" / "history" / "summary.json"
_DEFAULT_HEALTH_BASELINE = _REPO_ROOT / "data" / "health-baseline.json"

# Per-vendor carry-forward floor overrides (slug -> floor). Small-catalog vendors
# sit permanently below the global --floor (sized for the big AeroTech/CTI
# vendors), so they get a lower threshold matched to their catalog size. Loki
# lists ~60 reloads total from a single page (all-or-nothing), so anything in the
# low tens signals a degraded scrape.
_VENDOR_FLOORS = {"loki": 10}

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@catalog_app.command("refresh")
def catalog_refresh() -> None:
    """Download the catalog from ThrustCurve (all manufacturers) and load it into SQLite.

    If ThrustCurve is unreachable, fall back to the committed per-manufacturer
    cache rather than failing the run with an empty catalog (which would leave
    every listing unmatched). The run only fails if there is no cache to fall
    back to.
    """
    results = catalog.refresh_all()
    motors = [m for _, mfr_motors, _ in results for m in mfr_motors]
    for name, _motors, stale in results:
        if stale:
            typer.echo(
                f"WARNING: {name} live fetch failed — using committed cache (stale)",
                err=True,
            )
    summary = " + ".join(f"{len(mfr_motors)} {name}" for name, mfr_motors, _ in results)
    typer.echo(f"fetched {summary} = {len(motors)} motors from ThrustCurve")
    with db.connect() as conn:
        db.init_schema(conn)
        n = db.upsert_motors(conn, motors)
    typer.echo(f"upserted {n} motors into catalog")


@catalog_app.command("rematch")
def catalog_rematch() -> None:
    """Re-extract designations + re-match motor_id against existing listings.

    Use after improving the normalizer or refreshing the catalog. No HTTP traffic.
    """
    with db.connect() as conn:
        db.init_schema(conn)
        des_changed, motor_changed, total = db.rematch_listings(conn)
        matched = conn.execute("SELECT COUNT(*) FROM listings WHERE motor_id IS NOT NULL").fetchone()[0]
    typer.echo(
        f"re-extracted {des_changed} designations, "
        f"rematched {motor_changed} motor_ids "
        f"({matched}/{total} listings now mapped to a catalog motor)"
    )


@scrape_app.command("run")
def scrape_run(
    vendor: str = typer.Argument(..., help="vendor slug or 'all'"),
    limit: int | None = typer.Option(None, help="Cap the number of product pages scraped (smoke testing)"),
    interval: float | None = typer.Option(None, help="Override min start interval (seconds) between requests to one host"),
    concurrency: int | None = typer.Option(None, help="Override max concurrent requests per host"),
    min_diameter_mm: int = typer.Option(0, help="Skip motors with smaller diameter (e.g. 29 = HPR-only)"),
    only_urls: list[str] = typer.Option(
        [],
        "--url",
        help="Scrape only these explicit URLs (skips discovery). Repeat for multiple.",
    ),
) -> None:
    """Run one vendor scraper (or all)."""
    asyncio.run(_async_scrape_run(vendor, limit, interval, concurrency, min_diameter_mm, list(only_urls) if only_urls else None))


async def _async_scrape_run(
    vendor: str,
    limit: int | None,
    interval: float | None,
    concurrency: int | None,
    min_diameter_mm: int,
    only_urls_list: list[str] | None,
) -> None:
    targets = list(REGISTRY.values()) if vendor == "all" else [_get_vendor(vendor)]

    async def run_one(scraper_cls) -> None:
        scraper = scraper_cls()
        if min_diameter_mm > 0:
            scraper.min_diameter_mm = min_diameter_mm
        interval_s = interval if interval is not None else scraper.min_start_interval_s
        max_concurrent = concurrency if concurrency is not None else scraper.max_concurrent_per_host

        # Open the DB once around this vendor's scrape. We do reads (vendor row
        # insert, scrape_runs row) before any network and the listings write at
        # the end, so the connection isn't held during the network-bound work.
        with db.connect() as conn:
            db.init_schema(conn)
            vendor_id = db.upsert_vendor(conn, scraper.slug, scraper.name, scraper.homepage, scraper.state)
            started = _utc_now().isoformat(timespec="seconds")
            run_id = db.start_run(conn, vendor_id, started)

        ok, err, count = True, None, 0
        try:
            async with polite_async_client(
                max_concurrent_per_host=max_concurrent,
                min_start_interval_s=interval_s,
            ) as client:
                listings = await scraper.scrape(client, limit=limit, only_urls=only_urls_list)
            with db.connect() as conn:
                count = db.upsert_listings(conn, vendor_id, listings)
            typer.echo(f"{scraper.slug}: stored {count} listings")
        except Exception as e:
            ok = False
            err = repr(e)
            typer.echo(f"{scraper.slug}: FAILED — {err}", err=True)
            raise
        finally:
            with db.connect() as conn:
                finished = _utc_now().isoformat(timespec="seconds")
                db.finish_run(conn, run_id, finished, ok, count, err)

    # Scrape each vendor concurrently. Politeness is per-host, so this doesn't
    # increase load on any single vendor. ``return_exceptions=True`` isolates
    # failures: one vendor raising (timeout, connection reset, blocked IP) must
    # NOT cancel its in-flight siblings before they store their listings. Each
    # vendor still records its own ok/err in ``scrape_runs`` via run_one's
    # finally. We surface failures and only exit non-zero if EVERY vendor failed
    # — a partial scrape still feeds the snapshot's per-vendor carry-forward.
    results = await asyncio.gather(*[run_one(s) for s in targets], return_exceptions=True)
    failures = [
        (s.slug, r)
        for s, r in zip(targets, results, strict=True)
        if isinstance(r, BaseException)
    ]
    for slug, exc in failures:
        typer.echo(f"{slug}: scrape failed — {exc!r}", err=True)
    if failures and len(failures) == len(targets):
        raise typer.Exit(1)


@snapshot_app.command("export")
def snapshot_export(
    out: Path = typer.Option(
        Path(__file__).resolve().parents[2] / "data" / "snapshot.json",
        help="Output JSON path (frontend reads this)",
    ),
    floor: int = typer.Option(
        0,
        help=(
            "Per-vendor minimum listing count. When >0, a vendor that scrapes "
            "below this carries its listings forward from the existing --out "
            "snapshot (last-good) instead of vanishing. Exits non-zero only if a "
            "below-floor vendor has no prior data to fall back on. 0 disables."
        ),
    ),
    report_json: Path = typer.Option(
        None,
        help=(
            "Write per-vendor carry-forward health as JSON here (for CI alerting). "
            "Always written when set, even on a refuse-to-publish exit, so the "
            "alerting step can see what degraded."
        ),
    ),
    baseline_json: Path = typer.Option(
        _DEFAULT_HEALTH_BASELINE,
        help=(
            "Rolling per-vendor count/in-stock baseline file (read + rewritten). "
            "Powers anomaly detection: a vendor that's above floor but well below "
            "its own normal counts. Only used when --report-json is set."
        ),
    ),
) -> None:
    """Dump every motor with its per-vendor listings into one JSON file.

    Includes a separate ``unmatched`` array of listings whose ``motor_id`` is
    NULL so the UI can surface them as 'spec unknown' instead of silently
    dropping data.

    With ``--floor`` set, a degraded vendor (e.g. AMW/Sirius blocked from CI IPs)
    keeps its last-good listings from the previous snapshot rather than dropping
    out, so healthy vendors and new data still publish.
    """
    # When called directly (tests) rather than through the CLI, typer defaults
    # arrive unresolved (an OptionInfo); treat a non-int floor as disabled and
    # an unresolved report path as "don't write one".
    if not isinstance(floor, int):
        floor = 0
    if not isinstance(report_json, Path):
        report_json = None
    # Unresolved (called as a function in tests) → no baseline tracking, so tests
    # never touch the real data/health-baseline.json. The CLI resolves the default.
    if not isinstance(baseline_json, Path):
        baseline_json = None

    # Read the previous snapshot BEFORE we overwrite ``out``.
    prev = None
    if floor > 0 and out.exists():
        try:
            prev = json.loads(out.read_text())
        except (OSError, json.JSONDecodeError):
            prev = None

    with db.connect() as conn:
        motors = conn.execute(
            "SELECT id, manufacturer, designation, common_name, diameter_mm, impulse_class, "
            "       total_impulse_ns, avg_thrust_n, burn_time_s, propellant, "
            "       delays, delay_adjustable, availability "
            "FROM motors ORDER BY impulse_class, designation"
        ).fetchall()
        matched_listings = conn.execute(
            "SELECT l.motor_id, v.slug AS vendor_slug, v.name AS vendor_name, l.url, l.sku, "
            "       l.price_cents, l.currency, l.status, l.stock_count, l.lead_time, l.seen_at, "
            "       l.raw_title, l.raw_designation "
            "FROM listings l JOIN vendors v ON v.id = l.vendor_id "
            "WHERE l.motor_id IS NOT NULL"
        ).fetchall()
        unmatched_listings = conn.execute(
            "SELECT v.slug AS vendor_slug, v.name AS vendor_name, l.url, l.sku, "
            "       l.price_cents, l.currency, l.status, l.stock_count, l.seen_at, "
            "       l.raw_title, l.raw_designation "
            "FROM listings l JOIN vendors v ON v.id = l.vendor_id "
            "WHERE l.motor_id IS NULL "
            "ORDER BY l.raw_designation"
        ).fetchall()
        # Latest finished run per vendor — for per-vendor scrape duration in the
        # health report. A still-running/crashed run (finished_at IS NULL) is
        # excluded, so a hung scraper surfaces as an absent vendor, not a bogus time.
        latest_runs = db.latest_finished_runs(conn)

    by_motor: dict[int, list[dict]] = {}
    for r in matched_listings:
        by_motor.setdefault(r["motor_id"], []).append(
            {
                "vendor_slug": r["vendor_slug"],
                "vendor_name": r["vendor_name"],
                "url": r["url"],
                "sku": r["sku"],
                "price_cents": r["price_cents"],
                "currency": r["currency"],
                "status": r["status"],
                "stock_count": r["stock_count"],
                # Only emit lead_time when set, to keep the snapshot lean for the
                # vast majority of listings (normal stock-or-not vendors).
                **({"lead_time": r["lead_time"]} if r["lead_time"] else {}),
                "seen_at": r["seen_at"],
                "raw_designation": r["raw_designation"],
            }
        )

    payload = {
        "generated_at": _utc_now().isoformat(timespec="seconds"),
        # Only emit motors that have at least one matched listing. The frontend
        # already hides listing-less motors (`listings.length > 0`), so shipping
        # them is dead weight — and it keeps catalog-only motors (e.g. Cesaroni
        # loaded before its scraper exists) out of the snapshot entirely.
        "motors": [
            {
                "id": m["id"],
                "manufacturer": m["manufacturer"],
                "designation": m["designation"],
                "common_name": m["common_name"],
                "diameter_mm": m["diameter_mm"],
                "impulse_class": m["impulse_class"],
                "total_impulse_ns": m["total_impulse_ns"],
                "avg_thrust_n": m["avg_thrust_n"],
                "burn_time_s": m["burn_time_s"],
                "propellant": m["propellant"],
                "delays": m["delays"],
                "delay_adjustable": bool(m["delay_adjustable"]),
                # Out-of-production: matched to a discontinued ThrustCurve motor,
                # i.e. a vendor's old stock that won't be restocked once it sells.
                "discontinued": (m["availability"] or "") == "OOP",
                "listings": by_motor[m["id"]],
            }
            for m in motors
            if m["id"] in by_motor
        ],
        # Out-of-scope product lines (Q-Jet, Quest) are dropped here rather than
        # carried as "unmatched": they have no catalog entry by design, so they'd
        # otherwise inflate the couldn't-identify count and the per-vendor
        # unmatched-spike health metric forever. The remaining unmatched are
        # genuine in-scope products we failed to identify — the actionable signal.
        "unmatched": [
            {
                "raw_designation": r["raw_designation"],
                "raw_title": r["raw_title"],
                "vendor_slug": r["vendor_slug"],
                "vendor_name": r["vendor_name"],
                "url": r["url"],
                "sku": r["sku"],
                "price_cents": r["price_cents"],
                "currency": r["currency"],
                "status": r["status"],
                "stock_count": r["stock_count"],
                "seen_at": r["seen_at"],
            }
            for r in unmatched_listings
            if not is_out_of_scope(r["raw_title"], r["raw_designation"])
        ],
    }
    # Capture the FRESH per-vendor counts (total + in-stock + unmatched) BEFORE
    # carry_forward merges in last-good data, so anomaly detection judges what the
    # scraper actually returned this run, not carried-forward listings.
    fresh_stock = health.vendor_stock_counts(payload)
    fresh_unmatched = health.vendor_unmatched_counts(payload)

    failed: list[str] = []
    carried: list[str] = []
    if floor > 0:
        payload, report = carry_forward(payload, prev, floor, _VENDOR_FLOORS)
        typer.echo(f"snapshot floor={floor} — per-vendor:")
        for vendor in sorted(report["decision"]):
            d = report["decision"][vendor]
            fresh_n = report["fresh_counts"].get(vendor, 0)
            prev_n = report["prev_counts"].get(vendor, 0)
            note = f"carried {prev_n} from prev" if d == "carried" else (
                "NO PRIOR DATA" if d == "failed" else f"{fresh_n} fresh"
            )
            typer.echo(f"  {vendor:18s} {d:8s} ({note})")
        failed = report["failed"]
        carried = report["carried"]
        decision = report["decision"]
        fresh_counts = report["fresh_counts"]
        prev_counts = report["prev_counts"]
    else:
        # No floor → no carry-forward ran. Synthesize an all-healthy report so a
        # report-json consumer always gets a consistent shape.
        fresh_counts = vendor_counts(payload)
        prev_counts = {}
        decision = {v: "healthy" for v in fresh_counts}

    # Machine-readable health for CI alerting. The alerter stays quiet on a
    # transient carry-forward (that's the safety net working) and only escalates
    # when a vendor's published data has gone STALE for a sustained period. We
    # compute that age statelessly here: a carried vendor keeps its listings'
    # original ``seen_at``, so the gap to ``generated_at`` grows each hour the
    # outage persists — a healthy (just-scraped) vendor reads ~0.
    if report_json is not None:
        stale_hours = _vendor_stale_hours(payload, decision)
        ages = [h for h in stale_hours.values() if h is not None]

        # Baseline-relative anomaly detection: catch a vendor that's above floor
        # (so "healthy" + fresh) but well below its own normal listing/in-stock
        # counts — partial degradation or an in-stock-collapse parsing regression
        # that the floor + staleness checks miss. The baseline is a slow EWMA that
        # only learns from healthy, non-anomalous runs (no boiling-frog), and a
        # consecutive-run streak gates escalation. Skipped when no baseline path
        # is set (e.g. tests calling this function directly).
        anomalies: list[dict] = []
        sustained: list[dict] = []
        if baseline_json is not None:
            baseline = _load_json(baseline_json) or {}
            anomalies_now = health.detect_anomalies(
                fresh_stock, baseline, decision, fresh_unmatched=fresh_unmatched
            )
            baseline = health.update_baseline(
                baseline, fresh_stock, decision, anomalies_now, payload["generated_at"],
                fresh_unmatched=fresh_unmatched,
            )
            anomalies = health.annotate_streaks(anomalies_now, baseline)
            sustained = health.sustained_anomalies(anomalies_now, baseline)
            baseline_json.parent.mkdir(parents=True, exist_ok=True)
            baseline_json.write_text(json.dumps(baseline, indent=2, sort_keys=True))

        # Per-vendor scrape duration (seconds) from the latest finished run. Pure
        # visibility for now (not yet an escalation signal): a slow scrape is a
        # leading indicator of a vendor getting flaky. A vendor that was attempted
        # this run but has no finished run (hung/crashed before finish_run) is
        # absent from run_durations — surfaced separately as no_finished_run.
        run_durations: dict[str, float] = {}
        # Per-vendor last scrape error, categorized — only for vendors whose latest
        # finished run actually failed (ok=0), to keep the report lean. Lets the run
        # summary say WHY a carried/failed vendor broke without digging into logs.
        scrape_errors: dict[str, dict[str, str]] = {}
        for row in latest_runs:
            start = _parse_iso(row["started_at"])
            end = _parse_iso(row["finished_at"])
            if start is not None and end is not None:
                run_durations[row["vendor_slug"]] = round((end - start).total_seconds(), 1)
            if not row["ok"] and row["error"]:
                scrape_errors[row["vendor_slug"]] = {
                    "category": _categorize_scrape_error(row["error"]),
                    "detail": row["error"],
                }
        no_finished_run = sorted(v for v in decision if v not in run_durations)

        status = {
            "generated_at": payload["generated_at"],
            "floor": floor,
            "degraded": bool(carried or failed),
            "carried": carried,
            "failed": failed,
            "decision": decision,
            "fresh_counts": fresh_counts,
            "fresh_unmatched": fresh_unmatched,
            "prev_counts": prev_counts,
            # Per-vendor age of published data, hours. None = no published
            # listings (a failed vendor) or unparseable timestamps.
            "stale_hours": stale_hours,
            "max_stale_hours": max(ages) if ages else 0.0,
            # Per-vendor latest scrape duration (s) + the slowest, plus any vendor
            # this run that never recorded a finished run (a likely hang).
            "run_durations": run_durations,
            "max_run_seconds": max(run_durations.values()) if run_durations else 0.0,
            "no_finished_run": no_finished_run,
            # Per-vendor categorized last scrape error (failed runs only).
            "scrape_errors": scrape_errors,
            # Vendors above floor but well below their own baseline this run, and
            # the subset whose anomaly has persisted long enough to escalate.
            "anomalies": anomalies,
            "anomaly_sustained": bool(sustained),
        }
        report_json.parent.mkdir(parents=True, exist_ok=True)
        report_json.write_text(json.dumps(status, indent=2))
        typer.echo(
            f"wrote health report {report_json} "
            f"(degraded={status['degraded']}, max_stale_hours={status['max_stale_hours']}, "
            f"max_run_seconds={status['max_run_seconds']}, "
            f"anomalies={len(anomalies)}, anomaly_sustained={status['anomaly_sustained']})"
        )

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2))
    typer.echo(
        f"wrote {out} ({out.stat().st_size} bytes): "
        f"{sum(1 for m in payload['motors'] if m['listings'])} motors with listings, "
        f"{len(payload['unmatched'])} unmatched"
    )
    if failed:
        # A below-floor vendor with no prior data (brand-new, or chronically
        # blocked) keeps whatever partial fresh data it returned and is flagged
        # for alerting — but it must NOT block publishing everyone else's good
        # data. (Previously this exited non-zero, so one struggling new vendor
        # took the whole site's snapshot offline.)
        typer.echo(
            f"WARNING: below floor with no prior data (publishing their partial data anyway): "
            f"{', '.join(failed)}",
            err=True,
        )
    # The only catastrophe worth refusing to publish for is a snapshot with no
    # motor listings at all — e.g. a broken catalog refresh left everything
    # unmatched, or every vendor failed on a first-ever run with no prev to carry.
    # Only enforced when a floor is set (the automated/production path); with
    # floor=0 (local/dev) an empty snapshot is a valid empty state.
    if floor > 0 and not any(m["listings"] for m in payload["motors"]):
        typer.echo(
            "Refusing to publish — snapshot has no motor listings at all "
            "(likely a broken catalog or a total scrape failure).",
            err=True,
        )
        raise typer.Exit(1)


def _load_json(path: Path) -> dict:
    try:
        return json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError):
        return {}


@alerts_app.command("dispatch")
def alerts_dispatch(
    prev: Path = typer.Option(..., help="Previously published snapshot (last committed)"),
    current: Path = typer.Option(_DEFAULT_SNAPSHOT, help="Freshly written snapshot to compare against"),
    url: str = typer.Option("", help="Dispatch endpoint URL (default: $ALERTS_DISPATCH_URL)"),
    secret: str = typer.Option("", help="Bearer secret (default: $ALERTS_DISPATCH_SECRET)"),
    dry_run: bool = typer.Option(False, help="Compute + print restocks, don't POST"),
) -> None:
    """Diff prev vs current snapshot and POST the restocked motors to the alert
    dispatch route. Best-effort: if not configured, or if the POST fails, it logs
    and exits 0 — alerts must never break the hourly scrape/commit.
    """
    url = url or os.environ.get("ALERTS_DISPATCH_URL", "")
    secret = secret or os.environ.get("ALERTS_DISPATCH_SECRET", "")
    motors = restocked_motors(_load_json(prev), _load_json(current))
    typer.echo(f"alerts: {len(motors)} motor(s) restocked this run")
    if not motors:
        return
    if dry_run:
        for m in motors:
            typer.echo(f"  restocked: {m['manufacturer']} {m['designation']}")
        return
    if not url or not secret:
        typer.echo("alerts: dispatch not configured (ALERTS_DISPATCH_URL/SECRET unset) — skipping")
        return
    try:
        r = httpx.post(
            url,
            json={"motors": motors},
            headers={"Authorization": f"Bearer {secret}", "User-Agent": USER_AGENT},
            timeout=30,
        )
        typer.echo(f"alerts: dispatch -> HTTP {r.status_code}: {r.text[:200]}")
    except Exception as e:  # best-effort: never fail the scrape on alert errors
        typer.echo(f"alerts: dispatch failed (best-effort): {e!r}", err=True)


def _parse_iso(s: str | None) -> datetime | None:
    try:
        dt = datetime.fromisoformat(s) if s else None
    except (TypeError, ValueError):
        return None
    # Normalize naive → UTC (matches history._parse). carry_forward backfills
    # listings verbatim from the previous snapshot, and early archived snapshots
    # had tz-naive seen_at; mixing naive and aware in the stale-hours subtraction
    # below would raise TypeError and abort the export.
    if dt is not None and dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _categorize_scrape_error(err: str | None) -> str:
    """Coarse bucket for a stored ``scrape_runs.error`` (a ``repr(exception)``),
    so the health report can say *why* a vendor failed without a human opening
    the CI logs: a timeout/connection blip is usually transient, while an HTTP
    block or a parse error usually means a real break (IP blocked, site HTML
    changed). Heuristic on the exception repr — coarse on purpose, never raises."""
    if not err:
        return "none"
    e = err.lower()
    if "timeout" in e or "timedout" in e:
        return "timeout"
    if any(k in e for k in ("connect", "connection", "ssl", "getaddrinfo", "dns", "reset", "econn")):
        return "connection"
    if any(k in e for k in ("status", "403", "404", "429", "500", "502", "503", "blocked", "forbidden")):
        return "http"
    if any(k in e for k in ("parse", "json", "decode", "keyerror", "attributeerror", "indexerror", "selector", "nonetype")):
        return "parse"
    return "other"


def _vendor_stale_hours(payload: dict, decision: dict[str, str]) -> dict[str, float | None]:
    """Age (hours) of each vendor's freshest published listing vs ``generated_at``.

    A just-scraped vendor reads ~0; a vendor whose data is being carried forward
    reads how long ago that data was last genuinely scraped, which grows every
    hour the outage persists. ``None`` for a vendor with no published listings.
    """
    gen = _parse_iso(payload.get("generated_at"))
    newest: dict[str, datetime] = {}
    for m in payload.get("motors", []):
        for l in m.get("listings", []):
            dt = _parse_iso(l.get("seen_at"))
            if dt is None:
                continue
            v = l["vendor_slug"]
            if v not in newest or dt > newest[v]:
                newest[v] = dt
    out: dict[str, float | None] = {}
    for v in decision:
        nd = newest.get(v)
        out[v] = None if (nd is None or gen is None) else round((gen - nd).total_seconds() / 3600, 2)
    return out


# --- history -----------------------------------------------------------------
#
# The pure event-log logic lives in history.py; the CLI owns git-walking and IO.

def _git_commits_for(path: Path) -> list[str]:
    """Commit SHAs that touched ``path``, oldest first."""
    rel = path.relative_to(_REPO_ROOT)
    out = subprocess.run(
        ["git", "-C", str(_REPO_ROOT), "log", "--reverse", "--format=%H", "--", str(rel)],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.split()


def _git_snapshots(path: Path):
    """Yield each historical version of ``path`` parsed as a snapshot dict,
    oldest first. Unparseable early commits (before the file was valid JSON) are
    skipped with a warning."""
    rel = path.relative_to(_REPO_ROOT)
    for sha in _git_commits_for(path):
        blob = subprocess.run(
            ["git", "-C", str(_REPO_ROOT), "show", f"{sha}:{rel}"],
            capture_output=True, text=True,
        )
        if blob.returncode != 0 or not blob.stdout.strip():
            continue
        try:
            yield json.loads(blob.stdout)
        except json.JSONDecodeError:
            typer.echo(f"  skip {sha[:9]}: snapshot not valid JSON", err=True)


def _write_history(log: dict, log_out: Path, summary_out: Path, window_days: int) -> None:
    """Prune, write the log, derive + write the summary. Shared by both commands."""
    now = _utc_now().isoformat(timespec="seconds")
    log = history.prune(log, now, window_days)
    summary = history.summarize(log, now)
    for path, payload in ((log_out, log), (summary_out, summary)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2))
    typer.echo(
        f"history: {len(log['listings'])} listings tracked, "
        f"{len(summary)} summarized → {summary_out}"
    )


@history_app.command("backfill")
def history_backfill(
    snapshot_path: Path = typer.Option(_DEFAULT_SNAPSHOT, help="Tracked snapshot file to walk through git history"),
    log_out: Path = typer.Option(_DEFAULT_HISTORY_LOG, help="Where to write the full event log"),
    summary_out: Path = typer.Option(_DEFAULT_HISTORY_SUMMARY, help="Where to write the compact frontend summary"),
    window_days: int = typer.Option(180, help="Retain events within this many days (most recent always kept)"),
) -> None:
    """Rebuild the history log from scratch by replaying every committed version
    of the snapshot. One-time bootstrap — run locally and commit the result."""
    if not isinstance(window_days, int):
        window_days = 180
    log = history.backfill(_git_snapshots(snapshot_path))
    _write_history(log, log_out, summary_out, window_days)


@history_app.command("update")
def history_update(
    snapshot_path: Path = typer.Option(_DEFAULT_SNAPSHOT, help="Freshly-published snapshot to ingest"),
    log: Path = typer.Option(_DEFAULT_HISTORY_LOG, help="Existing event log to append to (created if absent)"),
    summary_out: Path = typer.Option(_DEFAULT_HISTORY_SUMMARY, help="Where to write the compact frontend summary"),
    window_days: int = typer.Option(180, help="Retain events within this many days (most recent always kept)"),
) -> None:
    """Append events from the current snapshot to the history log (run hourly
    after ``snapshot export``). Idempotent: an unchanged snapshot writes
    byte-identical files, so the CI commit no-ops."""
    if not isinstance(window_days, int):
        window_days = 180
    if not isinstance(log, Path):
        log = _DEFAULT_HISTORY_LOG
    if not isinstance(summary_out, Path):
        summary_out = _DEFAULT_HISTORY_SUMMARY

    try:
        current = history.empty_log() if not log.exists() else json.loads(log.read_text())
    except (OSError, json.JSONDecodeError):
        current = history.empty_log()
    snapshot = json.loads(Path(snapshot_path).read_text())
    updated = history.apply_snapshot(current, snapshot)
    _write_history(updated, log, summary_out, window_days)


def _get_vendor(slug: str):
    if slug not in REGISTRY:
        raise typer.BadParameter(f"unknown vendor: {slug}. Known: {sorted(REGISTRY)}")
    return REGISTRY[slug]


if __name__ == "__main__":
    app()
