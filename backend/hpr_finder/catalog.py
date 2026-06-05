"""Canonical motor catalog backed by ThrustCurve.org's public search API.

Docs: https://www.thrustcurve.org/info/api.html
Endpoint used: POST https://www.thrustcurve.org/api/v1/search.json
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx

from .http import USER_AGENT
from .models import Motor

THRUSTCURVE_SEARCH_URL = "https://www.thrustcurve.org/api/v1/search.json"
DATA_DIR = Path(__file__).resolve().parents[2] / "data"

# Per-manufacturer ThrustCurve caches. ``CACHE_PATH`` keeps its original name so
# existing callers and tests (which monkeypatch it) are unaffected.
CACHE_PATH = DATA_DIR / "thrustcurve_aerotech.json"
CESARONI_CACHE_PATH = DATA_DIR / "thrustcurve_cesaroni.json"


def fetch_motors(manufacturer: str, timeout: float = 30.0) -> list[dict]:
    """Hit ThrustCurve and return raw motor records for one manufacturer
    (available status only).

    ``manufacturer`` is the ThrustCurve manufacturer name, e.g. ``"AeroTech"`` or
    ``"Cesaroni"``. Default maxResults is 20, so we pass a large number to get the
    full catalog.
    """
    headers = {"User-Agent": USER_AGENT, "Content-Type": "application/json"}
    body = {"manufacturer": manufacturer, "availability": "available", "maxResults": 9999}
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


def to_motor(record: dict) -> Motor:
    """Map a raw ThrustCurve record into our Motor dataclass.

    Numeric fields are coerced through ``_maybe_int`` / ``_maybe_float`` so a
    junk value upstream (string when we expect a number) becomes ``None``
    rather than crashing the whole catalog refresh.
    """
    return Motor(
        manufacturer=record["manufacturer"],
        designation=record["designation"],
        common_name=record.get("commonName") or record["designation"],
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
    )


def aerotech_motors(use_cache: bool = True) -> list[Motor]:
    """Return Motor objects for AeroTech. Uses cache if present, otherwise fetches and caches."""
    if use_cache and CACHE_PATH.exists():
        raw = load_cache(CACHE_PATH)
    else:
        raw = fetch_aerotech_motors()
        save_cache(raw, CACHE_PATH)
    return [to_motor(r) for r in raw]


def cesaroni_motors(use_cache: bool = True) -> list[Motor]:
    """Return Motor objects for Cesaroni (CTI). Mirrors :func:`aerotech_motors`:
    cache-first, falling back to a live fetch that repopulates the cache."""
    if use_cache and CESARONI_CACHE_PATH.exists():
        raw = load_cache(CESARONI_CACHE_PATH)
    else:
        raw = fetch_motors("Cesaroni")
        save_cache(raw, CESARONI_CACHE_PATH)
    return [to_motor(r) for r in raw]


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
            return [to_motor(r) for r in load_cache(cache_path)], True
        raise
    save_cache(raw, cache_path)
    return [to_motor(r) for r in raw], False


def all_motors(use_cache: bool = True) -> list[Motor]:
    """Every manufacturer's motors, concatenated. The catalog's
    ``(manufacturer, designation)`` unique key keeps the two sets distinct, so a
    Cesaroni ``I445`` and an AeroTech motor never collide."""
    return aerotech_motors(use_cache) + cesaroni_motors(use_cache)


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
