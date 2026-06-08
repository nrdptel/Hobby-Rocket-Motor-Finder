"""Thrust-curve sample data from ThrustCurve.org's download API.

Docs: https://www.thrustcurve.org/info/api.html
Endpoint used: POST https://www.thrustcurve.org/api/v1/download.json

A motor often has several simfiles (certification, manufacturer, and
user-submitted), each a time/thrust point series. We pick ONE representative
curve per motor and write a compact sidecar (``data/curves.json``) keyed by
``"<manufacturer>|<designation>"`` so the frontend can join it to a snapshot
motor with no change to the snapshot contract. Curves are static per motor, so
this is refreshed only alongside the catalog, never on the hourly scrape.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import httpx

from .catalog import DATA_DIR, MANUFACTURERS, _cache_path, load_cache
from .http import USER_AGENT

THRUSTCURVE_DOWNLOAD_URL = "https://www.thrustcurve.org/api/v1/download.json"
CURVES_PATH = DATA_DIR / "curves.json"

# A point series for one curve: a list of [time_s, thrust_N] pairs.
ThrustCurve = list[list[float]]

# Source authority, best first: a certification curve is the measured data the
# cert org recorded; manufacturer next; user-submitted last. We prefer the most
# authoritative, then the one with the most sample points (smoother shape).
_SOURCE_RANK = {"cert": 0, "mfr": 1, "user": 2}


def curve_key(manufacturer: str, designation: str) -> str:
    """The sidecar key joining a curve to a (snapshot) motor. Neither field
    contains a ``|``, so the pair round-trips unambiguously."""
    return f"{manufacturer}|{designation}"


def _points(samples: list[dict]) -> ThrustCurve:
    """Clean a simfile's raw samples into sorted [t, F] pairs, dropping any
    non-numeric row and rounding to keep the sidecar compact."""
    pts: ThrustCurve = []
    for s in samples:
        t, f = s.get("time"), s.get("thrust")
        if isinstance(t, (int, float)) and isinstance(f, (int, float)) and t >= 0 and f >= 0:
            pts.append([round(float(t), 3), round(float(f), 2)])
    pts.sort(key=lambda p: p[0])
    return pts


def select_curve(simfiles: list[dict]) -> ThrustCurve | None:
    """Pick the best curve among a motor's simfiles: most authoritative source
    (cert > mfr > user), then most sample points. Returns the cleaned point
    series, or None when none has at least two usable points."""
    best_key: tuple[int, int] | None = None
    best_pts: ThrustCurve | None = None
    for sf in simfiles:
        pts = _points(sf.get("samples") or [])
        if len(pts) < 2 or pts[-1][0] <= 0:
            continue  # not a usable curve
        rank = _SOURCE_RANK.get(sf.get("source"), 3)
        key = (rank, -len(pts))
        if best_key is None or key < best_key:
            best_key, best_pts = key, pts
    return best_pts


def fetch_curves(
    motor_ids: list[str], timeout: float = 60.0, batch_size: int = 40
) -> dict[str, list[dict]]:
    """Download simfiles for many ThrustCurve motorIds, grouped by motorId.

    Batched (the download endpoint accepts many ids per call) and polite. Network
    I/O only; the selection/shaping is the pure ``select_curve``. Raises on HTTP
    error so the caller can fall back to the committed sidecar.
    """
    headers = {"User-Agent": USER_AGENT, "Content-Type": "application/json"}
    by_id: dict[str, list[dict]] = defaultdict(list)
    with httpx.Client(headers=headers, timeout=timeout) as c:
        for i in range(0, len(motor_ids), batch_size):
            chunk = motor_ids[i : i + batch_size]
            r = c.post(THRUSTCURVE_DOWNLOAD_URL, json={"motorIds": chunk, "data": "samples"})
            r.raise_for_status()
            for row in r.json().get("results", []):
                mid = row.get("motorId")
                if mid:
                    by_id[mid].append(row)
    return by_id


def _id_to_motor() -> dict[str, tuple[str, str]]:
    """Map ThrustCurve motorId → (manufacturer, designation) from the committed
    per-manufacturer catalog caches."""
    out: dict[str, tuple[str, str]] = {}
    for mc in MANUFACTURERS:
        for rec in load_cache(_cache_path(mc)):
            mid, mfr, des = rec.get("motorId"), rec.get("manufacturer"), rec.get("designation")
            if mid and mfr and des:
                out[mid] = (mfr, des)
    return out


def build_curves(
    id_to_motor: dict[str, tuple[str, str]], raw_by_id: dict[str, list[dict]]
) -> dict[str, ThrustCurve]:
    """Pure: turn raw download results into the sidecar map keyed by
    ``curve_key``, selecting one curve per motor. Motors with no usable curve are
    simply absent."""
    curves: dict[str, ThrustCurve] = {}
    for mid, (mfr, des) in id_to_motor.items():
        pts = select_curve(raw_by_id.get(mid, []))
        if pts:
            curves[curve_key(mfr, des)] = pts
    return curves


def refresh_curves(path: Path | None = None) -> int:
    """Fetch every catalog motor's thrust curve and write the sidecar. Returns the
    number of curves written."""
    path = path or CURVES_PATH
    id_to_motor = _id_to_motor()
    raw = fetch_curves(list(id_to_motor))
    curves = build_curves(id_to_motor, raw)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(curves, sort_keys=True, separators=(",", ":")) + "\n")
    return len(curves)
