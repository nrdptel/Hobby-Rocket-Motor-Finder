"""Multipack detection + per-unit price resolution, baked into the snapshot.

Some vendors list a low/mid-power motor in 2/3/12-packs and the scraped price is
for the WHOLE pack; the UI compares and displays a PER-UNIT price, so every
listing needs its pack size. Most vendors encode the size in the product URL
(``...-3-pack...``) and that's parsed reliably (mirrors ``frontend/lib/pack.ts``).
A few don't — an opaque product id, or a plain slug whose pack count only appears
in the page body we don't capture — so their pack price was being shown as if it
were a single, mis-stating the cost (e.g. a $27.99 3-pack shown as $27.99/motor).

For those stragglers we infer the size from CROSS-VENDOR CONSENSUS: when two or
more *different* vendors agree (via their URLs) that a motor is an N-pack, any
other listing of the same motor whose price sits in the same range as those
confirmed N-packs is almost certainly an N-pack too — a genuine single would be
priced about 1/N of that. Two gates keep a real single from being divided:
the size must be corroborated by >=2 distinct vendors, and the straggler's price
must clear a band set above the largest a single could plausibly be.

Packs only exist for low/mid power (HPR reloads aren't sold this way), and this
only fires where pack-URLs already exist, so it never touches HPR motors.

``resolve_pack_sizes`` annotates each matched listing with ``pack_size`` (1 for a
single). The frontend reads that field and falls back to its own URL parse when
it's absent (old snapshots), so this is backward compatible.
"""
from __future__ import annotations

import re
from urllib.parse import unquote

# Mirror of the patterns in frontend/lib/pack.ts — keep the two in sync.
# "3-pack" / "3 pack" / "12-pack" / "3pk" / "2-pk" / "2-motor-pack" / "pack of 3"
_PACK_RE = re.compile(
    r"(\d+)[-\s]*(?:motor[-\s]*)?packs?\b|(\d+)[-\s]*pks?\b|pack\s*of\s*(\d+)",
    re.I,
)
# Spelled-out forms vendors actually use: "two pack", "three-pack".
_WORD_PACK_RE = re.compile(
    r"\b(two|three|four|six|twelve)[-\s]*(?:motor[-\s]*)?packs?\b", re.I
)
_WORD_TO_N = {"two": 2, "three": 3, "four": 4, "six": 6, "twelve": 12}
# A single SKU isn't a 24-pack of motors; a bigger number is almost certainly
# something else in the URL, so don't trust it as a pack count.
_MAX_PACK = 24

# A straggler (no pack size in its URL) is treated as an N-pack only when its
# price is at least this fraction of the cheapest confirmed N-pack total for the
# motor. A real single is priced ~1/N of a pack, so its price is <= 0.5x the pack
# total even at N=2; 0.6 sits safely above that for any N>=2 while still catching
# packs priced at or above the confirmed ones.
_BAND = 0.6


def pack_size_from_url(url: str | None) -> int:
    """Pack quantity encoded in a listing URL, or 1 when there's no marker (or an
    explicit "1-pack"/"single pack"). Never raises."""
    if not url:
        return 1
    try:
        u = unquote(url)
    except Exception:
        u = url
    m = _PACK_RE.search(u)
    if m:
        n = int(m.group(1) or m.group(2) or m.group(3))
        return n if 2 <= n <= _MAX_PACK else 1
    w = _WORD_PACK_RE.search(u)
    return _WORD_TO_N.get(w.group(1).lower(), 1) if w else 1


def _consensus_size(listings: list[dict]) -> int | None:
    """The single pack size (>1) that >=2 distinct vendors encode in their URLs
    for this motor, or None when there's no agreement (or vendors conflict)."""
    by_size_vendors: dict[int, set[str]] = {}
    for l in listings:
        if l["pack_size"] > 1:
            by_size_vendors.setdefault(l["pack_size"], set()).add(l.get("vendor_slug"))
    agreed = [n for n, vendors in by_size_vendors.items() if len(vendors) >= 2]
    return agreed[0] if len(agreed) == 1 else None


def resolve_pack_sizes(snapshot: dict) -> dict:
    """Annotate every matched listing with a ``pack_size`` (mutates in place and
    returns ``snapshot``). URL-encoded sizes win per-listing; stragglers are
    filled by cross-vendor consensus + a price-band gate (see module docstring)."""
    for motor in snapshot.get("motors", []):
        listings = motor.get("listings", [])
        for l in listings:
            l["pack_size"] = pack_size_from_url(l.get("url"))

        n = _consensus_size(listings)
        if n is None:
            continue
        confirmed = [
            l["price_cents"]
            for l in listings
            if l["pack_size"] == n and l.get("price_cents") is not None
        ]
        if not confirmed:
            continue
        floor = _BAND * min(confirmed)
        for l in listings:
            if (
                l["pack_size"] == 1
                and l.get("price_cents") is not None
                and l["price_cents"] >= floor
            ):
                l["pack_size"] = n
    return snapshot
