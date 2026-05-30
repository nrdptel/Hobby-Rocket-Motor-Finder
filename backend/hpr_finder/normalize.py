"""Normalize a vendor's product title into a canonical AeroTech motor designation.

AeroTech motor designations follow patterns like:
    H242T-14A     (HPR reload: impulse class + avg thrust + propellant code + delay/adjustable suffix)
    G75J-10A      (mid-power reload)
    H283ST-14A    (DMS single-use)
    F67-6W        (low-mid power)

The vendor title usually includes extra words ("Aerotech H242T-14A Blue Thunder Rocket Motor"),
so we extract the designation token via regex.
"""
from __future__ import annotations

import re

# A loose match for AeroTech-style designations.
# Letter class (A-O) + digits + optional propellant letters + optional -delay suffix.
DESIGNATION_RE = re.compile(
    r"\b([A-O](?:\d{1,4})(?:[A-Z]{1,3})?(?:-\d{1,2}[A-Z]?)?)\b"
)


def extract_designation(title: str) -> str | None:
    """Return the first AeroTech-style designation found in a title, or None."""
    if not title:
        return None
    # Strip the manufacturer prefix to avoid false positives on words like "Aerotech".
    cleaned = re.sub(r"^\s*Aerotech\s+", "", title, flags=re.I)
    m = DESIGNATION_RE.search(cleaned)
    if not m:
        return None
    return m.group(1)


DELAY_SUFFIX_RE = re.compile(r"-\d{1,2}[A-Z]?$")
LP_DELAY_RE = re.compile(r"-\d{1,2}(?=[A-Z]{1,2}$)")


def base_designation(designation: str) -> str:
    """Strip an AeroTech delay-time suffix (e.g. H242T-14A -> H242T).

    Only strips a trailing ``-<digits><optional letter>`` pattern; bare
    designations (H242T, H283ST) pass through unchanged.
    """
    return DELAY_SUFFIX_RE.sub("", designation)


def lp_base_designation(designation: str) -> str:
    """Strip a low/mid-power delay infix, keeping the trailing propellant letter.

    AeroTech low-power motors use a different convention: the propellant letter
    sits *after* the delay (e.g. ``D13-10W``), whereas HPR motors put propellant
    before the delay (``H242T-14A``). This transform converts ``D13-10W`` to
    ``D13W`` to match the ThrustCurve canonical designation.
    """
    return LP_DELAY_RE.sub("", designation)
