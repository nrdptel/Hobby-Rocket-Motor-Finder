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


# Loki Research writes designations with a hyphen between the class letter and
# the thrust number, e.g. "N-5500-LW" (and some G-class reloads add an "HP-"
# prefix, e.g. "HP-G-69-SF"). Those are the only things that keep the
# AeroTech-style DESIGNATION_RE from matching; strip the prefix and collapse the
# hyphen and the shared extractor/matcher handle Loki (catalog has "N5500-LW" /
# "HP-G69-SF", commonNames "N5500" / "G69", which are unique so matching is
# unambiguous).
_LOKI_HP_PREFIX_RE = re.compile(r"^\s*HP-", re.IGNORECASE)
_LOKI_LEADING_HYPHEN_RE = re.compile(r"^\s*([G-O])-(\d)", re.IGNORECASE)


def extract_loki_designation(text: str) -> str | None:
    """Extract a Loki motor designation, normalizing the ``HP-`` prefix and the
    class-number hyphen (``N-5500-LW`` -> ``N5500-LW``, ``HP-G-69-SF`` ->
    ``G69-SF``) so :func:`extract_designation` applies. Matching then resolves via
    the (unique) Loki commonName."""
    if not text:
        return None
    stripped = _LOKI_HP_PREFIX_RE.sub("", text.strip())
    return extract_designation(_LOKI_LEADING_HYPHEN_RE.sub(r"\1\2", stripped))


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


# ---------------------------------------------------------------------------
# Cesaroni (CTI)
# ---------------------------------------------------------------------------
# CTI's scheme is fundamentally different from AeroTech: there is NO propellant
# letter inside the designation. ThrustCurve's canonical designation is
# ``<totImpulse><class><avgThrust>-<delay>A`` (e.g. ``234I445-16A``) and the
# ``commonName`` is just ``<class><avgThrust>`` (e.g. ``I445``). Vendors list the
# commonName, and the propellant is a separate *flavor* word in the title.
#
# Matching therefore keys on (commonName, flavor[, diameter]) — see
# ``db.find_motor_id``. See docs/CTI_spike.md for the full derivation.

# Class letter (CTI HPR runs roughly D..O) + 2-4 avg-thrust digits, e.g.
# I445, E22, N5600. The leading total-impulse number (the "234" in 234I445) and
# the trailing "-16A" delay are deliberately NOT captured — only the commonName.
CTI_COMMON_NAME_RE = re.compile(r"\b([D-O]\d{2,4})\b", re.IGNORECASE)

# Vendor flavor text -> ThrustCurve ``propInfo``. ORDER MATTERS: longest/most
# specific phrases first, so "White Thunder" wins over bare "White" and
# "Red Lightning" over bare "Red". Covers the abbreviations vendors actually use
# (Wildman: Green/Red/Blue/Skid Mark/C Star; csrocketry slug: smokey-sam). See
# the validated alias table in docs/CTI_spike.md.
CTI_FLAVOR_NAME_TO_INFO = [
    ("white thunder", "White Thunder"),
    ("blue streak", "Blue Streak"),
    ("red lightning", "Red Lightning"),
    ("smokey sam", "Smoky Sam"),
    ("smoky sam", "Smoky Sam"),
    ("skid mark", "Skidmark"),
    ("skidmark", "Skidmark"),
    ("c-star", "C-Star"),
    ("c star", "C-Star"),
    ("cstar", "C-Star"),
    ("green3", "Green3"),
    ("green", "Green3"),
    ("imax", "Imax"),
    ("vmax", "Vmax"),
    ("mellow", "Mellow"),
    ("classic", "Classic"),
    ("pink", "Pink"),
    ("red", "Red Lightning"),
    ("blue", "Blue Streak"),
    ("white", "White"),
]


def extract_cti_designation(title: str) -> str | None:
    """Return the Cesaroni commonName (class + avg thrust, e.g. ``I445``) from a
    vendor product title, or None.

    Handles the two real vendor formats:
      * csrocketry: ``Cesaroni I170-14A Classic Rocket Motor`` -> ``I170``
      * Wildman:    ``N5600-CTI White Thunder``               -> ``N5600``
    and the catalog's leading-total-impulse form (``234I445`` -> ``I445``).
    Result is uppercased for canonical storage and comparison.
    """
    if not title:
        return None
    # Strip Wildman's literal "-CTI"/"CTI" tag so it can't shadow the commonName.
    cleaned = re.sub(r"-?CTI\b", " ", title, flags=re.I)
    # Split the leading total-impulse form so the class token gets a word
    # boundary: "234I445" -> "234 I445".
    cleaned = re.sub(r"(?<=\d)(?=[D-O]\d)", " ", cleaned, flags=re.I)
    m = CTI_COMMON_NAME_RE.search(cleaned)
    return m.group(1).upper() if m else None


def infer_cti_propellant(title: str) -> str | None:
    """Find a CTI flavor name in the title and return ThrustCurve's canonical
    ``propInfo`` string (e.g. "White Thunder", "Skidmark"). None if absent.

    Underscores are treated as spaces so a vendor's ``Smoky_Sam`` matches the
    two-word ``smoky sam`` alias (Performance Hobbies writes some flavors that
    way)."""
    if not title:
        return None
    lower = title.lower().replace("_", " ")
    for needle, propinfo in CTI_FLAVOR_NAME_TO_INFO:
        if needle in lower:
            return propinfo
    return None
