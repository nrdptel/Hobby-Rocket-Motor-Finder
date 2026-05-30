from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .models import Listing, Motor
from .normalize import base_designation, lp_base_designation

SCHEMA = """
CREATE TABLE IF NOT EXISTS motors (
    id INTEGER PRIMARY KEY,
    manufacturer TEXT NOT NULL,
    designation TEXT NOT NULL,
    diameter_mm INTEGER NOT NULL,
    length_mm INTEGER,
    total_impulse_ns REAL,
    avg_thrust_n REAL,
    burn_time_s REAL,
    propellant TEXT,
    impulse_class TEXT NOT NULL,
    thrustcurve_id TEXT,
    UNIQUE (manufacturer, designation)
);

CREATE INDEX IF NOT EXISTS idx_motors_class_diameter ON motors (impulse_class, diameter_mm);

CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    homepage TEXT NOT NULL,
    state TEXT
);

CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id),
    motor_id INTEGER REFERENCES motors(id),
    raw_designation TEXT NOT NULL,
    raw_title TEXT NOT NULL,
    url TEXT NOT NULL,
    sku TEXT,
    price_cents INTEGER,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL,
    stock_count INTEGER,
    seen_at TEXT NOT NULL,
    UNIQUE (vendor_id, url)
);

CREATE INDEX IF NOT EXISTS idx_listings_motor ON listings (motor_id);
CREATE INDEX IF NOT EXISTS idx_listings_vendor ON listings (vendor_id);

CREATE TABLE IF NOT EXISTS scrape_runs (
    id INTEGER PRIMARY KEY,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    ok INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    listings_seen INTEGER NOT NULL DEFAULT 0
);
"""


DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "hpr.db"


@contextmanager
def connect(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    path = path or DEFAULT_DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def upsert_vendor(conn: sqlite3.Connection, slug: str, name: str, homepage: str, state: str | None = None) -> int:
    conn.execute(
        "INSERT INTO vendors (slug, name, homepage, state) VALUES (?, ?, ?, ?) "
        "ON CONFLICT (slug) DO UPDATE SET name=excluded.name, homepage=excluded.homepage, state=excluded.state",
        (slug, name, homepage, state),
    )
    return conn.execute("SELECT id FROM vendors WHERE slug=?", (slug,)).fetchone()[0]


def upsert_motors(conn: sqlite3.Connection, motors: list[Motor]) -> int:
    rows = [
        (
            m.manufacturer,
            m.designation,
            m.diameter_mm,
            m.length_mm,
            m.total_impulse_ns,
            m.avg_thrust_n,
            m.burn_time_s,
            m.propellant,
            m.impulse_class,
            m.thrustcurve_id,
        )
        for m in motors
    ]
    conn.executemany(
        "INSERT INTO motors (manufacturer, designation, diameter_mm, length_mm, total_impulse_ns, avg_thrust_n, burn_time_s, propellant, impulse_class, thrustcurve_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (manufacturer, designation) DO UPDATE SET "
        "diameter_mm=excluded.diameter_mm, length_mm=excluded.length_mm, total_impulse_ns=excluded.total_impulse_ns, "
        "avg_thrust_n=excluded.avg_thrust_n, burn_time_s=excluded.burn_time_s, propellant=excluded.propellant, "
        "impulse_class=excluded.impulse_class, thrustcurve_id=excluded.thrustcurve_id",
        rows,
    )
    return len(rows)


def find_motor_id(conn: sqlite3.Connection, manufacturer: str, designation: str) -> int | None:
    """Match a vendor designation to a canonical ThrustCurve motor.

    Tries (in order):
      1. Exact match.
      2. HPR transform: strip ``-<delay><A?>`` suffix (H242T-14A -> H242T).
      3. Low-power transform: strip ``-<delay>`` infix keeping trailing
         propellant letter (D13-10W -> D13W).
    """
    if not designation:
        return None
    for candidate in (designation, base_designation(designation), lp_base_designation(designation)):
        if not candidate:
            continue
        row = conn.execute(
            "SELECT id FROM motors WHERE manufacturer = ? COLLATE NOCASE AND designation = ? COLLATE NOCASE",
            (manufacturer, candidate),
        ).fetchone()
        if row:
            return row[0]
    return None


def upsert_listings(conn: sqlite3.Connection, vendor_id: int, listings: list[Listing]) -> int:
    rows = []
    for l in listings:
        motor_id = l.motor_id
        if motor_id is None:
            motor_id = find_motor_id(conn, "AeroTech", l.motor_designation)
        rows.append(
            (
                vendor_id,
                motor_id,
                l.motor_designation,
                l.raw_title,
                l.url,
                l.sku,
                l.price_cents,
                l.currency,
                l.status.value,
                l.stock_count,
                l.seen_at.isoformat(timespec="seconds"),
            )
        )
    conn.executemany(
        "INSERT INTO listings (vendor_id, motor_id, raw_designation, raw_title, url, sku, price_cents, currency, status, stock_count, seen_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (vendor_id, url) DO UPDATE SET "
        "motor_id=excluded.motor_id, raw_designation=excluded.raw_designation, raw_title=excluded.raw_title, "
        "sku=excluded.sku, price_cents=excluded.price_cents, currency=excluded.currency, status=excluded.status, "
        "stock_count=excluded.stock_count, seen_at=excluded.seen_at",
        rows,
    )
    return len(rows)


def start_run(conn: sqlite3.Connection, vendor_id: int, started_at: str) -> int:
    cur = conn.execute(
        "INSERT INTO scrape_runs (vendor_id, started_at) VALUES (?, ?)",
        (vendor_id, started_at),
    )
    return cur.lastrowid or 0


def finish_run(conn: sqlite3.Connection, run_id: int, finished_at: str, ok: bool, listings_seen: int, error: str | None = None) -> None:
    conn.execute(
        "UPDATE scrape_runs SET finished_at=?, ok=?, listings_seen=?, error=? WHERE id=?",
        (finished_at, 1 if ok else 0, listings_seen, error, run_id),
    )
