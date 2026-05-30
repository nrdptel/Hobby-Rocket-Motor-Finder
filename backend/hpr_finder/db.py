from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .models import Listing, Motor
from .normalize import (
    base_designation,
    common_name as title_common_name,
    extract_designation,
    infer_propellant_from_title,
    lp_base_designation,
    strip_plug_suffix,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS motors (
    id INTEGER PRIMARY KEY,
    manufacturer TEXT NOT NULL,
    designation TEXT NOT NULL,
    common_name TEXT NOT NULL DEFAULT '',
    diameter_mm INTEGER NOT NULL,
    length_mm INTEGER,
    total_impulse_ns REAL,
    avg_thrust_n REAL,
    burn_time_s REAL,
    propellant TEXT,
    impulse_class TEXT NOT NULL,
    delays TEXT,
    delay_adjustable INTEGER NOT NULL DEFAULT 0,
    thrustcurve_id TEXT,
    UNIQUE (manufacturer, designation)
);

CREATE INDEX IF NOT EXISTS idx_motors_class_diameter ON motors (impulse_class, diameter_mm);
-- idx_motors_common_name is created after the migration in init_schema, so this
-- file can be loaded against older databases that don't yet have the column.

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
    # Idempotent migration: add common_name column to motors if older DB lacks it.
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(motors)")}
    if "common_name" not in cols:
        conn.execute("ALTER TABLE motors ADD COLUMN common_name TEXT NOT NULL DEFAULT ''")
    if "delays" not in cols:
        conn.execute("ALTER TABLE motors ADD COLUMN delays TEXT")
    if "delay_adjustable" not in cols:
        conn.execute("ALTER TABLE motors ADD COLUMN delay_adjustable INTEGER NOT NULL DEFAULT 0")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_motors_common_name ON motors (common_name)")


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
            m.common_name,
            m.diameter_mm,
            m.length_mm,
            m.total_impulse_ns,
            m.avg_thrust_n,
            m.burn_time_s,
            m.propellant,
            m.impulse_class,
            m.delays,
            1 if m.delay_adjustable else 0,
            m.thrustcurve_id,
        )
        for m in motors
    ]
    conn.executemany(
        "INSERT INTO motors (manufacturer, designation, common_name, diameter_mm, length_mm, total_impulse_ns, avg_thrust_n, burn_time_s, propellant, impulse_class, delays, delay_adjustable, thrustcurve_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (manufacturer, designation) DO UPDATE SET "
        "common_name=excluded.common_name, diameter_mm=excluded.diameter_mm, length_mm=excluded.length_mm, "
        "total_impulse_ns=excluded.total_impulse_ns, avg_thrust_n=excluded.avg_thrust_n, "
        "burn_time_s=excluded.burn_time_s, propellant=excluded.propellant, "
        "impulse_class=excluded.impulse_class, delays=excluded.delays, "
        "delay_adjustable=excluded.delay_adjustable, thrustcurve_id=excluded.thrustcurve_id",
        rows,
    )
    return len(rows)


def find_motor_id(
    conn: sqlite3.Connection,
    manufacturer: str,
    designation: str,
    title: str | None = None,
) -> int | None:
    """Match a vendor designation (+ optional product title) to a canonical motor.

    Strategy, in order:
      1. Exact match on designation.
      2. HPR delay-suffix strip (H242T-14A -> H242T).
      3. Low-power delay-infix strip keeping trailing propellant (D13-10W -> D13W).
      4. Match against catalog's ``common_name`` and disambiguate by propellant
         inferred from the title (e.g. vendor "M1500" + title "Mojave Green" ->
         catalog motor M1500G).
      5. Match against ``common_name`` of the bare-designation form of the vendor
         string (covers "H115DM" -> catalog HP-H115DM whose common_name is H115).
    """
    if not designation:
        return None
    # Steps 1-4: try increasingly aggressive designation transforms against the
    # catalog's "designation" column (the canonical form ThrustCurve uses).
    transforms = (
        designation,
        base_designation(designation),                       # strip -14A
        lp_base_designation(designation),                    # strip -10 keeping W
        strip_plug_suffix(designation),                      # strip -P
        strip_plug_suffix(base_designation(designation)),    # strip both
    )
    for candidate in transforms:
        if not candidate:
            continue
        row = conn.execute(
            "SELECT id FROM motors WHERE manufacturer = ? COLLATE NOCASE AND designation = ? COLLATE NOCASE",
            (manufacturer, candidate),
        ).fetchone()
        if row:
            return row[0]
    # Steps 4-5: common_name with propellant disambiguation
    inferred_prop = infer_propellant_from_title(title or "")
    for cn in (designation, base_designation(designation), title_common_name(designation)):
        if not cn:
            continue
        if inferred_prop:
            row = conn.execute(
                "SELECT id FROM motors WHERE manufacturer = ? COLLATE NOCASE AND common_name = ? COLLATE NOCASE AND propellant = ? COLLATE NOCASE",
                (manufacturer, cn, inferred_prop),
            ).fetchone()
            if row:
                return row[0]
        # Last resort: common_name match without propellant disambiguation, only
        # if exactly one catalog motor shares that common_name (no ambiguity).
        rows = conn.execute(
            "SELECT id FROM motors WHERE manufacturer = ? COLLATE NOCASE AND common_name = ? COLLATE NOCASE",
            (manufacturer, cn),
        ).fetchall()
        if len(rows) == 1:
            return rows[0][0]
    return None


def upsert_listings(conn: sqlite3.Connection, vendor_id: int, listings: list[Listing]) -> int:
    rows = []
    for l in listings:
        motor_id = l.motor_id
        if motor_id is None:
            motor_id = find_motor_id(conn, "AeroTech", l.motor_designation, l.raw_title)
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


def rematch_listings(conn: sqlite3.Connection) -> tuple[int, int, int]:
    """Re-run normalization + motor matching against every existing listing.

    First re-runs ``extract_designation`` on each listing's stored title so the
    designation reflects the current regex (relevant when the parser is updated
    after a scrape was already stored). Then re-matches motor_id.

    Returns (designations_updated, motors_rematched, total).
    """
    listings = conn.execute(
        "SELECT id, raw_designation, raw_title, motor_id FROM listings"
    ).fetchall()
    designations_changed = 0
    motors_changed = 0
    for r in listings:
        new_des = extract_designation(r["raw_title"]) or r["raw_designation"]
        if new_des != r["raw_designation"]:
            conn.execute("UPDATE listings SET raw_designation = ? WHERE id = ?", (new_des, r["id"]))
            designations_changed += 1
        new_motor_id = find_motor_id(conn, "AeroTech", new_des, r["raw_title"])
        if new_motor_id != r["motor_id"]:
            conn.execute("UPDATE listings SET motor_id = ? WHERE id = ?", (new_motor_id, r["id"]))
            motors_changed += 1
    return designations_changed, motors_changed, len(listings)


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
