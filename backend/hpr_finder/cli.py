"""HPR Motor Finder CLI."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import typer

from . import catalog, db
from .http import polite_client
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


@scrape_app.command("run")
def scrape_run(
    vendor: str = typer.Argument(..., help="vendor slug or 'all'"),
    limit: int | None = typer.Option(None, help="Cap the number of product pages scraped (smoke testing)"),
    interval: float | None = typer.Option(None, help="Override per-host request interval in seconds"),
    min_diameter_mm: int = typer.Option(0, help="Skip motors with smaller diameter (e.g. 29 = HPR-only)"),
) -> None:
    """Run one vendor scraper (or all)."""
    targets = list(REGISTRY.values()) if vendor == "all" else [_get_vendor(vendor)]
    with db.connect() as conn:
        db.init_schema(conn)
        for scraper_cls in targets:
            scraper = scraper_cls()
            if min_diameter_mm > 0:
                scraper.min_diameter_mm = min_diameter_mm
            interval_s = interval if interval is not None else scraper.min_request_interval_s
            vendor_id = db.upsert_vendor(conn, scraper.slug, scraper.name, scraper.homepage, scraper.state)
            started = datetime.utcnow().isoformat(timespec="seconds")
            run_id = db.start_run(conn, vendor_id, started)
            ok, err, count = True, None, 0
            try:
                with polite_client(min_interval_s=interval_s) as client:
                    listings = scraper.scrape(client, limit=limit)
                count = db.upsert_listings(conn, vendor_id, listings)
                typer.echo(f"{scraper.slug}: stored {count} listings")
            except Exception as e:
                ok = False
                err = repr(e)
                typer.echo(f"{scraper.slug}: FAILED — {err}", err=True)
                raise
            finally:
                finished = datetime.utcnow().isoformat(timespec="seconds")
                db.finish_run(conn, run_id, finished, ok, count, err)


@snapshot_app.command("export")
def snapshot_export(
    out: Path = typer.Option(
        Path(__file__).resolve().parents[2] / "data" / "snapshot.json",
        help="Output JSON path (frontend reads this)",
    ),
) -> None:
    """Dump every motor with its per-vendor listings into one JSON file."""
    with db.connect() as conn:
        motors = conn.execute(
            "SELECT id, manufacturer, designation, diameter_mm, impulse_class, total_impulse_ns, "
            "       avg_thrust_n, burn_time_s, propellant "
            "FROM motors ORDER BY impulse_class, designation"
        ).fetchall()
        listings = conn.execute(
            "SELECT l.motor_id, v.slug AS vendor_slug, v.name AS vendor_name, l.url, l.sku, "
            "       l.price_cents, l.currency, l.status, l.stock_count, l.seen_at, l.raw_title "
            "FROM listings l JOIN vendors v ON v.id = l.vendor_id "
            "WHERE l.motor_id IS NOT NULL"
        ).fetchall()

    by_motor: dict[int, list[dict]] = {}
    for r in listings:
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
            }
        )

    payload = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds"),
        "motors": [
            {
                "id": m["id"],
                "manufacturer": m["manufacturer"],
                "designation": m["designation"],
                "diameter_mm": m["diameter_mm"],
                "impulse_class": m["impulse_class"],
                "total_impulse_ns": m["total_impulse_ns"],
                "avg_thrust_n": m["avg_thrust_n"],
                "burn_time_s": m["burn_time_s"],
                "propellant": m["propellant"],
                "listings": by_motor.get(m["id"], []),
            }
            for m in motors
        ],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2))
    typer.echo(f"wrote {out} ({out.stat().st_size} bytes)")


def _get_vendor(slug: str):
    if slug not in REGISTRY:
        raise typer.BadParameter(f"unknown vendor: {slug}. Known: {sorted(REGISTRY)}")
    return REGISTRY[slug]


if __name__ == "__main__":
    app()
