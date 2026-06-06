from __future__ import annotations

import logging
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .models import Listing, Motor
from .normalize import (
    base_designation,
    extract_cti_designation,
    extract_designation,
    infer_cti_propellant,
    infer_propellant_from_title,
    lp_base_designation,
    strip_internal_hyphens,
    strip_no_hyphen_delay,
    strip_plug_suffix,
)
from .normalize import (
    common_name as title_common_name,
)

logger = logging.getLogger(__name__)

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
    availability TEXT,
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
    -- Manufacturer this listing matches against (routes find_motor_id) and an
    -- optional diameter hint for Cesaroni collision-breaking. Defaults keep
    -- existing AeroTech-only databases working without a backfill.
    manufacturer TEXT NOT NULL DEFAULT 'AeroTech',
    diameter_mm INTEGER,
    -- Human-readable order lead time for backorder vendors (e.g. "16–20 weeks");
    -- NULL for normal stock-or-not vendors.
    lead_time TEXT,
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
    if "availability" not in cols:
        conn.execute("ALTER TABLE motors ADD COLUMN availability TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_motors_common_name ON motors (common_name)")
    # Idempotent migration: add manufacturer/diameter routing columns to listings
    # if an older DB predates multi-manufacturer support.
    lcols = {r["name"] for r in conn.execute("PRAGMA table_info(listings)")}
    if "manufacturer" not in lcols:
        conn.execute("ALTER TABLE listings ADD COLUMN manufacturer TEXT NOT NULL DEFAULT 'AeroTech'")
    if "diameter_mm" not in lcols:
        conn.execute("ALTER TABLE listings ADD COLUMN diameter_mm INTEGER")
    if "lead_time" not in lcols:
        conn.execute("ALTER TABLE listings ADD COLUMN lead_time TEXT")


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
            m.availability,
        )
        for m in motors
    ]
    conn.executemany(
        "INSERT INTO motors (manufacturer, designation, common_name, diameter_mm, length_mm, total_impulse_ns, avg_thrust_n, burn_time_s, propellant, impulse_class, delays, delay_adjustable, thrustcurve_id, availability) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (manufacturer, designation) DO UPDATE SET "
        "common_name=excluded.common_name, diameter_mm=excluded.diameter_mm, length_mm=excluded.length_mm, "
        "total_impulse_ns=excluded.total_impulse_ns, avg_thrust_n=excluded.avg_thrust_n, "
        "burn_time_s=excluded.burn_time_s, propellant=excluded.propellant, "
        "impulse_class=excluded.impulse_class, delays=excluded.delays, "
        "delay_adjustable=excluded.delay_adjustable, thrustcurve_id=excluded.thrustcurve_id, "
        "availability=excluded.availability",
        rows,
    )
    return len(rows)


# SQL fragment that restricts a match to current (in-production) motors. NULL
# availability (rows from before the column existed) counts as current.
_EXCLUDE_OOP = " AND (availability IS NULL OR availability <> 'OOP')"


def find_motor_id(
    conn: sqlite3.Connection,
    manufacturer: str,
    designation: str,
    title: str | None = None,
    diameter_mm: int | None = None,
) -> int | None:
    """Match a vendor designation (+ optional product title) to a canonical motor.

    Runs the match in TWO passes: first against current (in-production) motors
    only, then — only if nothing matched — against the full catalog including
    out-of-production (OOP) motors. This lets a vendor's old-stock listing match a
    discontinued motor (e.g. AeroTech E15W) while guaranteeing that adding OOP
    motors can never divert a listing a current motor already matches: pass 1 sees
    exactly the current-only catalog, so its result is identical to before. The
    OOP pass only runs for listings that were previously unmatched.

    Dispatches on manufacturer: Cesaroni has a different designation grammar (no
    propellant letter) and so a different match path — see
    :func:`_find_cti_motor_id`. AeroTech uses the transform chain below.

    AeroTech strategy within each pass, in order:
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
    match = (
        _find_cti_motor_id
        if manufacturer.lower().startswith("cesaroni")
        else _find_at_motor_id
    )
    # Current-only pass first, then a full pass that also allows OOP motors.
    for av_filter in (_EXCLUDE_OOP, ""):
        mid = match(conn, manufacturer, designation, title, diameter_mm, av_filter)
        if mid is not None:
            return mid
    return None


def _find_at_motor_id(
    conn: sqlite3.Connection,
    manufacturer: str,
    designation: str,
    title: str | None,
    diameter_mm: int | None,
    av_filter: str,
) -> int | None:
    """AeroTech match within one availability pool (``av_filter`` is the SQL
    fragment restricting to current motors, or "" for the full catalog)."""
    # Steps 1-N: increasingly aggressive designation transforms vs the catalog's
    # "designation" column (the canonical form ThrustCurve uses).
    base = base_designation(designation)
    plug = strip_plug_suffix(base)
    # Double plug strip handles vendor SKUs that stack two markers like
    # H13ST-P-NTR (catalog has bare H13ST).
    plug_twice = strip_plug_suffix(plug)
    internal = strip_internal_hyphens(base)
    transforms = (
        designation,
        base,                                       # strip -14A
        lp_base_designation(designation),           # strip -10 keeping W
        strip_plug_suffix(designation),             # strip -P
        plug,                                       # strip -P then -14A
        plug_twice,                                 # H13ST-P-NTR -> H13ST
        internal,                                   # H550-ST -> H550ST
        strip_internal_hyphens(plug),               # combo
        strip_no_hyphen_delay(internal),            # J340-M14A -> J340M14A -> J340M
    )
    for candidate in transforms:
        if not candidate:
            continue
        row = conn.execute(
            "SELECT id FROM motors WHERE manufacturer = ? COLLATE NOCASE AND designation = ? COLLATE NOCASE"
            + av_filter,
            (manufacturer, candidate),
        ).fetchone()
        if row:
            return row[0]
    # Steps 4-5: common_name with propellant disambiguation.
    inferred_prop = infer_propellant_from_title(title or "")
    for cn in (designation, base_designation(designation), title_common_name(designation)):
        if not cn:
            continue
        if inferred_prop:
            row = conn.execute(
                "SELECT id FROM motors WHERE manufacturer = ? COLLATE NOCASE AND common_name = ? COLLATE NOCASE AND propellant = ? COLLATE NOCASE"
                + av_filter,
                (manufacturer, cn, inferred_prop),
            ).fetchone()
            if row:
                return row[0]
        # Last resort: common_name match without propellant disambiguation, only
        # if exactly one catalog motor in this pool shares that common_name.
        rows = conn.execute(
            "SELECT id FROM motors WHERE manufacturer = ? COLLATE NOCASE AND common_name = ? COLLATE NOCASE"
            + av_filter,
            (manufacturer, cn),
        ).fetchall()
        if len(rows) == 1:
            return rows[0][0]
    return None


def _find_cti_motor_id(
    conn: sqlite3.Connection,
    manufacturer: str,
    designation: str,
    title: str | None,
    diameter_mm: int | None,
    av_filter: str,
) -> int | None:
    """Match a Cesaroni listing to a catalog motor within one availability pool.

    ``designation`` is the CTI commonName (e.g. ``I445``) — there is no
    propellant letter, so we match on the catalog's ``common_name`` column and
    disambiguate by the flavor inferred from the title. The only commonName+flavor
    collision in the catalog (H123 Skidmark, 29mm vs 38mm) is resolved by
    ``diameter_mm`` when the scraper supplies it. Falls back to a commonName-only
    match when it is unambiguous.
    """
    common = designation.upper()
    propinfo = infer_cti_propellant(title or "")
    if propinfo:
        rows = conn.execute(
            "SELECT id, diameter_mm FROM motors "
            "WHERE manufacturer = ? COLLATE NOCASE AND common_name = ? COLLATE NOCASE "
            "AND propellant = ? COLLATE NOCASE" + av_filter,
            (manufacturer, common, propinfo),
        ).fetchall()
        if len(rows) == 1:
            return rows[0][0]
        if len(rows) > 1:
            if diameter_mm is not None:
                for r in rows:
                    if r["diameter_mm"] == diameter_mm:
                        return r["id"]
            # Ambiguous (the lone H123-Skidmark 29mm/38mm collision) with no
            # diameter hint to break it. Refuse to guess: a coin-flip pick would
            # show a flyer the wrong specs half the time, which is worse than an
            # honest "unidentified". Mirrors the commonName-only ambiguity path
            # below, which also returns None. Surface it so a new collision (e.g.
            # if the catalog ever grows another) doesn't stay silent.
            logger.warning(
                "CTI match ambiguous for common_name=%s propellant=%s (%d candidates, "
                "no diameter hint) — leaving unmatched",
                common, propinfo, len(rows),
            )
            return None
    # Fallback: commonName alone, only when it identifies exactly one motor.
    rows = conn.execute(
        "SELECT id FROM motors WHERE manufacturer = ? COLLATE NOCASE AND common_name = ? COLLATE NOCASE"
        + av_filter,
        (manufacturer, common),
    ).fetchall()
    if len(rows) == 1:
        return rows[0][0]
    return None


def upsert_listings(conn: sqlite3.Connection, vendor_id: int, listings: list[Listing]) -> int:
    rows = []
    for l in listings:
        motor_id = l.motor_id
        if motor_id is None:
            motor_id = find_motor_id(
                conn, l.manufacturer, l.motor_designation, l.raw_title, l.diameter_mm
            )
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
                l.manufacturer,
                l.diameter_mm,
                l.lead_time,
                l.seen_at.isoformat(timespec="seconds"),
            )
        )
    conn.executemany(
        "INSERT INTO listings (vendor_id, motor_id, raw_designation, raw_title, url, sku, price_cents, currency, status, stock_count, manufacturer, diameter_mm, lead_time, seen_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (vendor_id, url) DO UPDATE SET "
        "motor_id=excluded.motor_id, raw_designation=excluded.raw_designation, raw_title=excluded.raw_title, "
        "sku=excluded.sku, price_cents=excluded.price_cents, currency=excluded.currency, status=excluded.status, "
        "stock_count=excluded.stock_count, manufacturer=excluded.manufacturer, diameter_mm=excluded.diameter_mm, "
        "lead_time=excluded.lead_time, seen_at=excluded.seen_at",
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
        "SELECT id, raw_designation, raw_title, motor_id, manufacturer, diameter_mm FROM listings"
    ).fetchall()
    designations_changed = 0
    motors_changed = 0
    for r in listings:
        manufacturer = r["manufacturer"] or "AeroTech"
        is_cti = manufacturer.lower().startswith("cesaroni")
        extract = extract_cti_designation if is_cti else extract_designation
        new_des = extract(r["raw_title"]) or r["raw_designation"]
        if new_des != r["raw_designation"]:
            conn.execute("UPDATE listings SET raw_designation = ? WHERE id = ?", (new_des, r["id"]))
            designations_changed += 1
        new_motor_id = find_motor_id(
            conn, manufacturer, new_des, r["raw_title"], r["diameter_mm"]
        )
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


def latest_finished_runs(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """The most recent FINISHED run per vendor — one row each, latest by
    ``started_at``. Rows carry ``vendor_slug, started_at, finished_at, ok, error,
    listings_seen`` so the caller can derive per-vendor scrape duration. A run
    still in flight (or crashed before ``finish_run``) has ``finished_at IS NULL``
    and is excluded, so a hung scraper shows up as an ABSENT vendor here rather
    than a bogus duration."""
    return conn.execute(
        """
        SELECT v.slug AS vendor_slug, r.started_at, r.finished_at,
               r.ok, r.error, r.listings_seen
        FROM scrape_runs r
        JOIN vendors v ON v.id = r.vendor_id
        JOIN (
            SELECT vendor_id, MAX(started_at) AS m
            FROM scrape_runs
            WHERE finished_at IS NOT NULL
            GROUP BY vendor_id
        ) latest ON latest.vendor_id = r.vendor_id AND latest.m = r.started_at
        WHERE r.finished_at IS NOT NULL
        """
    ).fetchall()
