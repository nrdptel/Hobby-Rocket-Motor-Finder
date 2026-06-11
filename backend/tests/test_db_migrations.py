"""init_schema's idempotent column migrations — the path that upgrades an OLDER
database that predates a column. Every other db test starts from a fresh schema,
so without this the ADD COLUMN branches never actually run."""
import sqlite3

from hpr_finder import db

# Columns init_schema must add to a pre-migration database.
_MIGRATED_MOTOR_COLS = {
    "common_name", "delays", "delay_adjustable", "availability",
    "motor_type", "case_info", "sparky", "prop_weight_g",
}
_MIGRATED_LISTING_COLS = {"manufacturer", "diameter_mm", "lead_time"}


def _old_db() -> sqlite3.Connection:
    """A connection whose motors/listings tables predate every migrated column."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE motors (
            id INTEGER PRIMARY KEY,
            manufacturer TEXT NOT NULL,
            designation TEXT NOT NULL,
            diameter_mm INTEGER NOT NULL,
            impulse_class TEXT NOT NULL,
            UNIQUE (manufacturer, designation)
        );
        CREATE TABLE listings (
            id INTEGER PRIMARY KEY,
            vendor_id INTEGER NOT NULL,
            motor_id INTEGER,
            raw_designation TEXT NOT NULL,
            raw_title TEXT NOT NULL,
            url TEXT NOT NULL,
            status TEXT NOT NULL,
            seen_at TEXT NOT NULL,
            UNIQUE (vendor_id, url)
        );
        """
    )
    return conn


def test_init_schema_adds_missing_columns_to_old_db():
    conn = _old_db()
    db.init_schema(conn)

    motor_cols = {r["name"] for r in conn.execute("PRAGMA table_info(motors)")}
    assert _MIGRATED_MOTOR_COLS <= motor_cols
    listing_cols = {r["name"] for r in conn.execute("PRAGMA table_info(listings)")}
    assert _MIGRATED_LISTING_COLS <= listing_cols

    # The common_name index is created only after the column migration ran.
    indexes = {r["name"] for r in conn.execute("PRAGMA index_list(motors)")}
    assert "idx_motors_common_name" in indexes
    conn.close()


def test_init_schema_is_idempotent():
    conn = _old_db()
    db.init_schema(conn)
    # Running again on the already-migrated db must not raise (no duplicate-column
    # ALTERs) and must leave the columns intact.
    db.init_schema(conn)
    motor_cols = {r["name"] for r in conn.execute("PRAGMA table_info(motors)")}
    assert _MIGRATED_MOTOR_COLS <= motor_cols
    conn.close()


def test_init_schema_on_fresh_db_has_all_columns():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    db.init_schema(conn)  # creates tables from scratch via CREATE TABLE
    motor_cols = {r["name"] for r in conn.execute("PRAGMA table_info(motors)")}
    assert _MIGRATED_MOTOR_COLS <= motor_cols
    listing_cols = {r["name"] for r in conn.execute("PRAGMA table_info(listings)")}
    assert _MIGRATED_LISTING_COLS <= listing_cols
    conn.close()
