from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum


def _utc_now() -> datetime:
    """Timezone-aware UTC now. Replaces deprecated datetime.utcnow()."""
    return datetime.now(UTC)


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
    designation: str  # e.g. "H242T", "M1500G"
    common_name: str  # e.g. "H242", "M1500" — designation minus propellant code
    diameter_mm: int
    length_mm: int | None
    total_impulse_ns: float | None
    avg_thrust_n: float | None
    burn_time_s: float | None
    propellant: str | None
    impulse_class: str  # single letter A..O
    delays: str | None  # e.g. "4,6,8,10" or "P" (plugged) or None
    delay_adjustable: bool
    thrustcurve_id: str | None = None
    # ThrustCurve availability ("regular"/"OOP"/...). OOP (out-of-production)
    # motors are carried so vendors' old-stock listings still match; the matcher
    # prefers a current motor over an OOP one on any common-name ambiguity.
    availability: str | None = None
    # ThrustCurve motor type: "reload" / "SU" (single-use) / "hybrid". Powers the
    # case filter — reloads need hardware, single-use don't.
    motor_type: str | None = None
    # The reload hardware the motor uses, verbatim from ThrustCurve, e.g.
    # "RMS-38/720", "Pro38-3G", "38/480". None for single-use motors.
    case_info: str | None = None
    # Sparky propellant (titanium/metal-additive — throws gold sparks), from
    # ThrustCurve's `sparky` flag. Powers the sparky filter/badge.
    sparky: bool = False
    # Propellant grain mass in grams (ThrustCurve `propWeightG`); the basis for
    # the derived specific-impulse figure. None when unknown.
    prop_weight_g: float | None = None


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
    # Which manufacturer's catalog this listing should be matched against.
    # Defaults to AeroTech so existing scrapers need no change; Cesaroni
    # scrapers set "Cesaroni Technology" (the name ThrustCurve stores).
    manufacturer: str = "AeroTech"
    # Optional diameter hint (mm) the matcher uses to break the lone Cesaroni
    # commonName+flavor collision. Recovered by the scraper from the Pro-size in
    # the product URL; None for AeroTech.
    diameter_mm: int | None = None
    # Optional human-readable order lead time, e.g. "16–20 weeks". Set only by
    # vendors that backorder rather than stock (currently AeroTech-direct, whose
    # status is special_order with a fulfillment-time tier); None elsewhere.
    lead_time: str | None = None
    seen_at: datetime = field(default_factory=_utc_now)


@dataclass(slots=True)
class ScrapeRun:
    vendor_slug: str
    started_at: datetime
    finished_at: datetime | None = None
    ok: bool = False
    error: str | None = None
    listings_seen: int = 0
