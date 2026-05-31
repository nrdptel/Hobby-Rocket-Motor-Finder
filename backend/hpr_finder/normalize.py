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
# F23-RCW-SK, K1800ST-P, M1500, M1297w-p (case-insensitive).
DESIGNATION_RE = re.compile(
    r"\b([A-O]\d{1,4}[A-Z]{0,3}(?:-[A-Z0-9]{1,4}){0,3})\b",
    re.IGNORECASE,
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
    """Return the first AeroTech-style designation found in a title, or None.

    Match is case-insensitive (catches typos like ``M1297w-p``) but the result
    is always uppercased for canonical storage and downstream comparison.
    """
    if not title:
        return None
    cleaned = re.sub(r"^\s*Aerotech\s+", "", title, flags=re.I)
    m = DESIGNATION_RE.search(cleaned)
    if not m:
        return None
    return m.group(1).upper()


DELAY_SUFFIX_RE = re.compile(r"-\d{1,2}[A-Z]{0,3}$", re.IGNORECASE)
LP_DELAY_RE = re.compile(r"-\d{1,2}(?=[A-Z]{1,3}$)", re.IGNORECASE)
# Hyphen between a digit and an uppercase letter — vendor sometimes inserts one
# inside the designation (H550-ST vs catalog H550ST). Doesn't match the leading
# "HP-" prefix because the char before the hyphen there is a LETTER, not a digit.
INTERNAL_HYPHEN_RE = re.compile(r"(?<=\d)-(?=[A-Z])", re.IGNORECASE)
# Delay code WITHOUT a hyphen, preceded by a propellant-letter that follows
# thrust digits. Catches Sirius's "J340-M14A" -> internal-hyphen-strip ->
# "J340M14A" -> strip "14A" -> "J340M" (catalog).
# Lookbehind requires DIGIT-then-LETTER immediately before the strip target,
# so it doesn't fire on:
#   - "D13W" (lookbehind off the start)
#   - "G54W" (only one letter before)
#   - "H242T" / "M1297W" (digit-digit before, not digit-letter)
NO_HYPHEN_DELAY_RE = re.compile(r"(?<=\d[A-Z])\d{1,2}[A-Z]$", re.IGNORECASE)
# Trailing alphabetic suffix the catalog may or may not include. Covers:
#   * Plug markers: -P (plugged), -PS (plugged smoky-sam), -NTR (no test rocket
#     included), -SK (sounding-kit).
#   * Variant tags: -L (long delay variant), -C (when vendor hyphenates the
#     propellant code, e.g. F67-C vs catalog F67C).
#   * General multi-letter suffixes the vendor adds but catalog doesn't.
# Catalog sometimes includes them (I40N-P, K1800ST-P) and sometimes doesn't
# (J401FJ-L at vendor vs J401FJ in catalog). Exact-match is tried first; this
# stripper is one of the fallback transforms.
PLUG_SUFFIX_RE = re.compile(r"-[A-Z]{1,3}$", re.IGNORECASE)


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


def strip_internal_hyphens(designation: str) -> str:
    """Strip hyphens between a digit and an uppercase letter.

    Used when the vendor inserts a hyphen between the thrust number and the
    propellant code, e.g. ``H550-ST-14A`` -> after base strips ``-14A`` ->
    ``H550-ST`` -> ``H550ST`` (matches catalog).

    Preserves the leading ``HP-`` style prefix (the hyphen there is between
    two letters, not digit-then-letter).
    """
    return INTERNAL_HYPHEN_RE.sub("", designation)


def strip_no_hyphen_delay(designation: str) -> str:
    """Strip a trailing delay code that's glued to a propellant letter without
    a separating hyphen.

    Catches the form ``J340M14A`` (no hyphen between M and 14A) which appears
    after :func:`strip_internal_hyphens` collapses Sirius's ``J340-M14A`` ->
    ``J340M14A``. The lookbehind requires the digits to follow a letter, so
    "H242T" / "M1297W" / similar normal designations stay untouched.
    """
    return NO_HYPHEN_DELAY_RE.sub("", designation)


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


# Map ThrustCurve propellant name -> AeroTech's single/multi-letter code.
# Used when constructing a vendor designation from a delay-variant SKU (e.g.,
# BRM sells D13 with three Shopify variants {4,7,10}; we synthesize a SKU
# like "D13-4W" by appending the propellant letter inferred from the title).
PROPELLANT_LETTER = {
    "White Lightning": "W",
    "Blue Thunder": "T",
    "Redline": "R",
    "Blackjack": "J",
    "Mojave Green": "G",
    "Dark Matter": "DM",
    "Super Thunder": "ST",
    "Super White Lightning": "WS",
    "Metalstorm": "M",
    "Warp 9": "N",
    "Propellant X": "X",
    "Classic": "C",
    "Black Max": "FJ",
}


def propellant_letter(name: str | None) -> str:
    """Map a propellant name to the 1-3 letter code AeroTech uses in
    designations. Returns "" if unknown."""
    if not name:
        return ""
    return PROPELLANT_LETTER.get(name, "")
