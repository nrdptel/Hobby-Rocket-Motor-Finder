from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class StockStatus(str, Enum):
    IN_STOCK_WITH_COUNT = "in_stock_with_count"
    IN_STOCK = "in_stock"
    OUT_OF_STOCK = "out_of_stock"
    SPECIAL_ORDER = "special_order"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class Motor:
    """A canonical motor from the ThrustCurve catalog."""

    manufacturer: str
    designation: str  # e.g. "H242T-14A"
    diameter_mm: int
    length_mm: int | None
    total_impulse_ns: float | None
    avg_thrust_n: float | None
    burn_time_s: float | None
    propellant: str | None
    impulse_class: str  # single letter A..O
    thrustcurve_id: str | None = None


@dataclass(slots=True)
class Listing:
    """A vendor's listing of a motor at a point in time."""

    vendor_slug: str
    motor_designation: str  # raw, before normalization
    motor_id: int | None  # FK to motors table after normalization
    url: str
    sku: str | None
    price_cents: int | None
    currency: str
    status: StockStatus
    stock_count: int | None
    raw_title: str
    seen_at: datetime = field(default_factory=datetime.utcnow)


@dataclass(slots=True)
class ScrapeRun:
    vendor_slug: str
    started_at: datetime
    finished_at: datetime | None = None
    ok: bool = False
    error: str | None = None
    listings_seen: int = 0
