"""Shared price → integer-cents conversion for the vendor scrapers.

Every scraper extracts a price (from JSON-LD, a table cell, a Shopify variant,
etc.) and converts it to integer cents. The conversion was reimplemented in each
scraper — some stripping thousands-separator commas, some not. This is the one
place that turns a parsed price into cents, so the behaviour is consistent
(money handling shouldn't vary by vendor).
"""
from __future__ import annotations

import re

_NON_NUMERIC_RE = re.compile(r"[^\d.]")


def price_to_cents(value: str | float | int | None) -> int | None:
    """Convert a price to integer cents, or ``None`` if it can't be parsed.

    Accepts a number, or a string like ``"$1,234.50"`` / ``"1234.50"`` — any
    currency symbol, thousands separators, and surrounding whitespace are
    stripped before conversion.
    """
    if value is None:
        return None
    if isinstance(value, str):
        value = _NON_NUMERIC_RE.sub("", value)
        if not value:
            return None
    try:
        return int(round(float(value) * 100))
    except (TypeError, ValueError):
        return None
