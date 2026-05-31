"""HPR Motor Finder CLI."""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

import typer

from . import catalog, db
from .http import polite_async_client
from .models import _utc_now
from .scrapers import REGISTRY

app = typer.Typer(help="HPR motor availability aggregator CLI", no_args_is_help=True)
catalog_app = typer.Typer(help="Manage the canonical motor catalog")
scrape_app = typer.Typer(help="Run vendor scrapers")
snapshot_app = typer.Typer(help="Export the current state for the frontend")
app.add_typer(catalog_app, name="catalog")
app.add_typer(scrape_app, name="scrape")
app.add_typer(snapshot_app, name="snapshot")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@catalog_app.command("refresh")
def catalog_refresh() -> None:
    """Download the AeroTech subset of ThrustCurve and load it into SQLite."""
    motors = catalog.aerotech_motors(use_cache=False)
    typer.echo(f"fetched {len(motors)} AeroTech motors from ThrustCurve")
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
    # increase load on any single vendor.
    await asyncio.gather(*[run_one(s) for s in targets])


@snapshot_app.command("export")
def snapshot_export(
    out: Path = typer.Option(
        Path(__file__).resolve().parents[2] / "data" / "snapshot.json",
        help="Output JSON path (frontend reads this)",
    ),
) -> None:
    """Dump every motor with its per-vendor listings into one JSON file.

    Includes a separate ``unmatched`` array of listings whose ``motor_id`` is
    NULL so the UI can surface them as 'spec unknown' instead of silently
    dropping data.
    """
    with db.connect() as conn:
        motors = conn.execute(
            "SELECT id, manufacturer, designation, common_name, diameter_mm, impulse_class, "
            "       total_impulse_ns, avg_thrust_n, burn_time_s, propellant, "
            "       delays, delay_adjustable "
            "FROM motors ORDER BY impulse_class, designation"
        ).fetchall()
        matched_listings = conn.execute(
            "SELECT l.motor_id, v.slug AS vendor_slug, v.name AS vendor_name, l.url, l.sku, "
            "       l.price_cents, l.currency, l.status, l.stock_count, l.seen_at, "
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
                "seen_at": r["seen_at"],
                "raw_designation": r["raw_designation"],
            }
        )

    payload = {
        "generated_at": _utc_now().isoformat(timespec="seconds"),
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
                "listings": by_motor.get(m["id"], []),
            }
            for m in motors
        ],
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
        ],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2))
    typer.echo(
        f"wrote {out} ({out.stat().st_size} bytes): "
        f"{sum(1 for m in payload['motors'] if m['listings'])} motors with listings, "
        f"{len(payload['unmatched'])} unmatched"
    )


def _get_vendor(slug: str):
    if slug not in REGISTRY:
        raise typer.BadParameter(f"unknown vendor: {slug}. Known: {sorted(REGISTRY)}")
    return REGISTRY[slug]


if __name__ == "__main__":
    app()
