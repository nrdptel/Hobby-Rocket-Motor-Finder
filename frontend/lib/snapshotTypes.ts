// Pure shared data types (no fs / no runtime imports). Split out of snapshot.ts
// so client components can import these types without dragging snapshot.ts's
// `node:fs` loader into a client/edge bundle. snapshot.ts re-exports all of
// these, so existing `import { Motor } from "@/lib/snapshot"` callers are
// unchanged; client code that must stay fs-free imports from here directly.

export type StockStatus =
  | "in_stock_with_count"
  | "in_stock"
  | "out_of_stock"
  | "special_order"
  | "unknown";

export type Listing = {
  vendor_slug: string;
  vendor_name: string;
  url: string;
  sku: string | null;
  raw_designation: string;
  price_cents: number | null;
  currency: string;
  status: StockStatus;
  stock_count: number | null;
  // Order lead time for backorder vendors (e.g. "16–20 weeks"), shown next to a
  // special-order badge. Absent for normal stock-or-not listings.
  lead_time?: string | null;
  seen_at: string;
  // Multipack size resolved at snapshot-export time (1 = single). Optional for
  // back-compat with snapshots written before the field existed; when absent the
  // pack helpers fall back to parsing the size out of the URL.
  pack_size?: number;
};

export type Motor = {
  id: number;
  manufacturer: string;
  designation: string;
  common_name?: string;
  diameter_mm: number;
  impulse_class: string;
  total_impulse_ns: number | null;
  avg_thrust_n: number | null;
  burn_time_s: number | null;
  propellant: string | null;
  delays: string | null;
  delay_adjustable: boolean;
  // Out of production — matched to a discontinued ThrustCurve motor, i.e. old
  // stock that won't be restocked once it sells out. Optional for back-compat
  // with snapshots written before the field existed.
  discontinued?: boolean;
  // ThrustCurve motor type ("reload" / "SU" / "hybrid") and the reload hardware
  // the motor uses (e.g. "RMS-38/720", "Pro38-3G"). case_info is null for
  // single-use motors. Both optional for back-compat with older snapshots.
  motor_type?: string | null;
  case_info?: string | null;
  // Sparky (metal-additive) propellant flag, and propellant grain mass in grams
  // (the basis for derived specific impulse). Both optional for back-compat with
  // snapshots written before these fields existed.
  sparky?: boolean;
  prop_weight_g?: number | null;
  listings: Listing[];
};

export type UnmatchedListing = {
  raw_designation: string;
  raw_title: string;
  vendor_slug: string;
  vendor_name: string;
  url: string;
  sku: string | null;
  price_cents: number | null;
  currency: string;
  status: StockStatus;
  stock_count: number | null;
  seen_at: string;
};

export type Snapshot = {
  generated_at: string;
  motors: Motor[];
  unmatched: UnmatchedListing[];
};

// Per-listing stock/price history, keyed by listing `url`, derived by the
// backend `hpr history` commands. The UI currently surfaces only restock
// timing; the price_* fields are carried for a future price-trend view.
export type ListingHistory = {
  currently_in_stock: boolean;
  status_current: StockStatus;
  first_seen_at: string;
  last_change_at: string;
  last_in_stock_at: string | null;
  last_restock_at: string | null;
  restock_count: number;
  price_current_cents: number | null;
  price_prev_cents: number | null;
  price_low_cents: number | null;
  price_high_cents: number | null;
};

export type HistorySummary = Record<string, ListingHistory>;

// The subset of ListingHistory the client catalog actually reads — restock
// timing (restockLabel) + the price-signal rollup (priceSignal). The full
// summary's other fields (status_current, first_seen_at, last_change_at,
// restock_count, price_current_cents) are only used server-side on the motor
// detail page, so they're projected out before the catalog ships to the
// browser. A full ListingHistory is assignable to this, so server callers that
// already hold the full record keep working unchanged.
export type CatalogListingHistory = Pick<
  ListingHistory,
  | "currently_in_stock"
  | "last_in_stock_at"
  | "last_restock_at"
  | "price_prev_cents"
  | "price_low_cents"
  | "price_high_cents"
>;

export type CatalogHistorySummary = Record<string, CatalogListingHistory>;
