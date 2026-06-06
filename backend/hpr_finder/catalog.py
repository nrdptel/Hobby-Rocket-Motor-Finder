"""Canonical motor catalog backed by ThrustCurve.org's public search API.

Docs: https://www.thrustcurve.org/info/api.html
Endpoint used: POST https://www.thrustcurve.org/api/v1/search.json
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import NamedTuple

import httpx

from .http import USER_AGENT
from .models import Motor

THRUSTCURVE_SEARCH_URL = "https://www.thrustcurve.org/api/v1/search.json"
DATA_DIR = Path(__file__).resolve().parents[2] / "data"

# Per-manufacturer ThrustCurve caches. ``CACHE_PATH`` keeps its original name so
# existing callers and tests (which monkeypatch it) are unaffected.
CACHE_PATH = DATA_DIR / "thrustcurve_aerotech.json"
CESARONI_CACHE_PATH = DATA_DIR / "thrustcurve_cesaroni.json"
LOKI_CACHE_PATH = DATA_DIR / "thrustcurve_loki.json"


class ManufacturerCatalog(NamedTuple):
    """One manufacturer we pull from ThrustCurve. ``cache_attr`` is the name of
    the module global holding its cache Path (not the Path itself) so it resolves
    at call time and stays monkeypatch-friendly for tests — see ``_cache_path``."""

    thrustcurve_name: str  # ThrustCurve query term, e.g. "AeroTech", "Cesaroni"
    cache_attr: str


# Single source of truth for which manufacturers the catalog covers. Adding one
# is a single entry here (plus a match strategy in ``db.find_motor_id`` only if
# its designation grammar differs from AeroTech's). ``all_motors``,
# ``refresh_all``, and the CLI's ``catalog refresh`` all iterate this list.
MANUFACTURERS: tuple[ManufacturerCatalog, ...] = (
    ManufacturerCatalog("AeroTech", "CACHE_PATH"),
    ManufacturerCatalog("Cesaroni", "CESARONI_CACHE_PATH"),
    # Query term "Loki"; ThrustCurve stores the name as "Loki Research", which is
    # what the Loki scraper sets on its listings so they match this catalog.
    ManufacturerCatalog("Loki", "LOKI_CACHE_PATH"),
)


def _cache_path(mc: ManufacturerCatalog) -> Path:
    # Resolve the cache Path from the module global at call time so a test that
    # monkeypatches ``CACHE_PATH`` reaches the registry-driven code paths too.
    return globals()[mc.cache_attr]


def fetch_motors(manufacturer: str, timeout: float = 30.0) -> list[dict]:
    """Hit ThrustCurve and return raw motor records for one manufacturer.

    ``manufacturer`` is the ThrustCurve manufacturer name, e.g. ``"AeroTech"`` or
    ``"Cesaroni"``. Default maxResults is 20, so we pass a large number to get the
    full catalog.

    ``availability="all"`` (rather than ``"available"``) deliberately includes
    out-of-production (OOP) motors. Vendors routinely sell old stock of
    discontinued motors — especially during shortages, when a flyer's only option
    is a NLA reload someone still has on a shelf — and those listings would
    otherwise land in the "unmatched" bucket with no specs. ThrustCurve still
    carries the spec data for OOP motors, so including them lets us match e.g. an
    AeroTech E15W or J350W reload that a vendor is clearing out. (OOP designations
    don't collide with current ones, and catalog motors with no listing are
    dropped from the snapshot, so this adds matches without bloat.)
    """
    headers = {"User-Agent": USER_AGENT, "Content-Type": "application/json"}
    body = {"manufacturer": manufacturer, "availability": "all", "maxResults": 9999}
    with httpx.Client(headers=headers, timeout=timeout) as c:
        r = c.post(THRUSTCURVE_SEARCH_URL, json=body)
        r.raise_for_status()
        return r.json().get("results", [])


def fetch_aerotech_motors(timeout: float = 30.0) -> list[dict]:
    """Back-compat wrapper for the AeroTech subset. New code should prefer
    :func:`fetch_motors`. Kept because ``aerotech_motors`` and its tests refer
    to this name."""
    return fetch_motors("AeroTech", timeout)


def save_cache(records: list[dict], path: Path | None = None) -> None:
    # Resolve at call time so tests can monkeypatch ``CACHE_PATH`` and have it
    # reach helpers invoked with the default. Capturing the default at def
    # time would freeze the original path.
    path = path or CACHE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(records, indent=2, sort_keys=True))


def load_cache(path: Path | None = None) -> list[dict]:
    path = path or CACHE_PATH
    return json.loads(path.read_text())


def to_motor(record: dict) -> Motor | None:
    """Map a raw ThrustCurve record into our Motor dataclass, or None if the
    record is unusable (missing the required manufacturer/designation keys).

    Numeric fields are coerced through ``_maybe_int`` / ``_maybe_float`` so a
    junk value upstream (string when we expect a number) becomes ``None``
    rather than crashing the whole catalog refresh. Likewise a single record
    missing the two required string keys is skipped (returns None) rather than
    raising and aborting the refresh of the entire (multi-manufacturer) catalog.
    """
    manufacturer = record.get("manufacturer")
    designation = record.get("designation")
    if not manufacturer or not designation:
        return None
    return Motor(
        manufacturer=manufacturer,
        designation=designation,
        common_name=record.get("commonName") or designation,
        diameter_mm=_maybe_int(record.get("diameter")) or 0,
        length_mm=_maybe_int(record.get("length")),
        total_impulse_ns=_maybe_float(record.get("totImpulseNs")),
        avg_thrust_n=_maybe_float(record.get("avgThrustN")),
        burn_time_s=_maybe_float(record.get("burnTimeS")),
        propellant=record.get("propInfo"),
        impulse_class=record.get("impulseClass") or "",
        delays=record.get("delays"),
        delay_adjustable=bool(record.get("delayAdjustable")),
        thrustcurve_id=record.get("motorId"),
        availability=record.get("availability"),
        motor_type=record.get("type"),
        case_info=record.get("caseInfo"),
    )


def _motors_from(records: list[dict]) -> list[Motor]:
    """Map raw ThrustCurve records to Motors, skipping any unusable record
    (``to_motor`` returns None) so one bad row can't abort the catalog."""
    return [m for r in records if (m := to_motor(r)) is not None]


def aerotech_motors(use_cache: bool = True) -> list[Motor]:
    """Return Motor objects for AeroTech. Uses cache if present, otherwise fetches and caches."""
    if use_cache and CACHE_PATH.exists():
        raw = load_cache(CACHE_PATH)
    else:
        raw = fetch_aerotech_motors()
        save_cache(raw, CACHE_PATH)
    return _motors_from(raw)


def cesaroni_motors(use_cache: bool = True) -> list[Motor]:
    """Return Motor objects for Cesaroni (CTI). Mirrors :func:`aerotech_motors`:
    cache-first, falling back to a live fetch that repopulates the cache."""
    if use_cache and CESARONI_CACHE_PATH.exists():
        raw = load_cache(CESARONI_CACHE_PATH)
    else:
        raw = fetch_motors("Cesaroni")
        save_cache(raw, CESARONI_CACHE_PATH)
    return _motors_from(raw)


def refresh_catalog(manufacturer: str, cache_path: Path) -> tuple[list[Motor], bool]:
    """Fetch one manufacturer's catalog live and refresh its on-disk cache.

    If the live fetch fails (ThrustCurve down, slow, or returning an HTTP error)
    AND a committed cache exists, fall back to that cache so the hourly run still
    has a catalog to match listings against — a stale catalog is far better than
    an empty one, which would leave every listing unmatched and trip the snapshot
    floor for every vendor. Re-raises only when the fetch fails and there is no
    cache to fall back to (a first run with neither has nothing to offer).

    Returns ``(motors, used_cache_fallback)``.
    """
    try:
        raw = fetch_motors(manufacturer)
    except (httpx.HTTPError, OSError):
        if cache_path.exists():
            return _motors_from(load_cache(cache_path)), True
        raise
    save_cache(raw, cache_path)
    return _motors_from(raw), False


def _manufacturer_motors(thrustcurve_name: str, cache_path: Path, use_cache: bool) -> list[Motor]:
    """Cache-first load of one manufacturer's catalog: read the cache if present,
    else fetch live and repopulate it. The registry-driven counterpart of the
    per-manufacturer ``aerotech_motors`` / ``cesaroni_motors`` shims."""
    if use_cache and cache_path.exists():
        raw = load_cache(cache_path)
    else:
        raw = fetch_motors(thrustcurve_name)
        save_cache(raw, cache_path)
    return _motors_from(raw)


def refresh_all() -> list[tuple[str, list[Motor], bool]]:
    """Live-refresh every manufacturer in :data:`MANUFACTURERS`, each falling back
    to its committed cache on fetch failure. Returns one
    ``(manufacturer, motors, used_cache_fallback)`` per manufacturer so the caller
    can report which (if any) came back stale."""
    return [
        (mc.thrustcurve_name, *refresh_catalog(mc.thrustcurve_name, _cache_path(mc)))
        for mc in MANUFACTURERS
    ]


def all_motors(use_cache: bool = True) -> list[Motor]:
    """Every manufacturer's motors, concatenated. The catalog's
    ``(manufacturer, designation)`` unique key keeps the sets distinct, so a
    Cesaroni ``I445`` and an AeroTech motor never collide."""
    motors: list[Motor] = []
    for mc in MANUFACTURERS:
        motors.extend(_manufacturer_motors(mc.thrustcurve_name, _cache_path(mc), use_cache))
    return motors


def _maybe_int(v) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _maybe_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
