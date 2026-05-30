"""Normalize a vendor's product title into a canonical AeroTech motor designation.

AeroTech motor designations follow patterns like:
    H242T-14A     (HPR reload: impulse class + avg thrust + propellant code + delay/adjustable suffix)
    G75J-10A      (mid-power reload)
    H283ST-14A    (DMS single-use)
    F67-6W        (low-mid power)
    F23-4FJ       (low-power Black Max, 2-letter propellant)
    M1500         (large HPR sold by common name; propellant only in title)
"""
from __future__ import annotations

import re

# A loose match for AeroTech-style designations.
# Letter class (A-O) + digits + optional propellant letters + up to three
# hyphen-separated suffix tokens. Suffix tokens can be:
#   - delay+propellant: "-14A", "-10W", "-4FJ"  (digit prefix)
#   - propellant-only:  "-RCT", "-RCJ", "-RCW"  (no digits — used by older AT lines)
#   - plug suffix:       "-P", "-PS", "-SK"      (1-3 trailing letters)
# Examples that should match: H242T-14A, D13-10W, F23-4FJ, H283ST, G12-RCT,
# F23-RCW-SK, K1800ST-P, M1500.
DESIGNATION_RE = re.compile(
    r"\b([A-O]\d{1,4}[A-Z]{0,3}(?:-[A-Z0-9]{1,4}){0,3})\b"
)

# Map propellant marketing names (as seen in vendor product titles) to the
# canonical "propInfo" string ThrustCurve stores on the motor record.
# Order matters: longer phrases first so "Super White Lightning" beats "White Lightning".
PROPELLANT_NAME_TO_INFO = [
    ("Super White Lightning", "Super White Lightning"),
    ("Super Thunder", "Super Thunder"),
    ("White Lightning", "White Lightning"),
    ("Blue Thunder", "Blue Thunder"),
    ("Black Jack", "Blackjack"),  # ThrustCurve normalizes to single word
    ("Blackjack", "Blackjack"),
    ("Black Max", "Black Max"),
    ("Mojave Green", "Mojave Green"),
    ("Dark Matter", "Dark Matter"),
    ("Metal Storm", "Metalstorm"),
    ("Metalstorm", "Metalstorm"),
    ("Warp 9", "Warp 9"),
    ("Warp9", "Warp 9"),
    ("Propellant X", "Propellant X"),
    ("Redline", "Redline"),
    ("Classic", "Classic"),
]


def extract_designation(title: str) -> str | None:
    """Return the first AeroTech-style designation found in a title, or None."""
    if not title:
        return None
    cleaned = re.sub(r"^\s*Aerotech\s+", "", title, flags=re.I)
    m = DESIGNATION_RE.search(cleaned)
    if not m:
        return None
    return m.group(1)


DELAY_SUFFIX_RE = re.compile(r"-\d{1,2}[A-Z]{0,3}$")
LP_DELAY_RE = re.compile(r"-\d{1,2}(?=[A-Z]{1,3}$)")
# AeroTech "plug" markers: -P = plugged (no ejection charge), -PS = plugged
# smoky-sam, -NTR = no test rocket included, -SK = sounding-kit. Catalog
# sometimes includes them in the designation (I40N-P, K1800ST-P) and sometimes
# doesn't (G339N has -P at vendor but bare in catalog). We try both.
PLUG_SUFFIX_RE = re.compile(r"-(?:PS|NTR|SK|P)$")


def base_designation(designation: str) -> str:
    """Strip an AeroTech delay-time suffix (e.g. H242T-14A -> H242T).

    Only strips a trailing ``-<digits><optional letters>`` pattern; bare
    designations (H242T, H283ST) pass through unchanged.
    """
    return DELAY_SUFFIX_RE.sub("", designation)


def lp_base_designation(designation: str) -> str:
    """Strip a low/mid-power delay infix, keeping the trailing propellant letter(s).

    AeroTech low/mid-power motors put the propellant letter(s) *after* the delay
    (e.g. ``D13-10W``, ``F23-4FJ``), whereas HPR motors put propellant before the
    delay (``H242T-14A``). This transform converts ``D13-10W`` to ``D13W`` and
    ``F23-4FJ`` to ``F23FJ`` so they match ThrustCurve's canonical designation.
    """
    return LP_DELAY_RE.sub("", designation)


def strip_plug_suffix(designation: str) -> str:
    """Strip an AeroTech plug-style suffix (``-P``, ``-PS``, ``-NTR``, ``-SK``)."""
    return PLUG_SUFFIX_RE.sub("", designation)


def common_name(designation: str) -> str:
    """Strip the trailing propellant code from a vendor designation.

    Returns the bare motor identifier (impulse class + thrust number) used as
    ThrustCurve's ``commonName``. E.g. H242T -> H242, M1500G -> M1500,
    F23FJ -> F23. Designations with a delay suffix (``-14A``) or plug suffix
    (``-P``) have those stripped first.
    """
    base = strip_plug_suffix(base_designation(designation))
    return re.sub(r"[A-Z]{1,3}$", "", base) or base


def infer_propellant_from_title(title: str) -> str | None:
    """Find a propellant marketing name in the title and return ThrustCurve's
    canonical ``propInfo`` string. Returns None if no known propellant is named.
    """
    if not title:
        return None
    lower = title.lower()
    for needle, propinfo in PROPELLANT_NAME_TO_INFO:
        if needle.lower() in lower:
            return propinfo
    return None
