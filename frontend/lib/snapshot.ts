import { readFile } from "node:fs/promises";
import path from "node:path";

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

// Both snapshots live inside the frontend project at build time. The actual
// source-of-truth files are in the repo's top-level `data/` dir; the prebuild
// `copy-snapshot.mjs` script copies them in before `next build`/`next dev`
// runs. This indirection is required because Next 16 + Turbopack refuses
// file traces outside the project root, so reading from `../data/` would
// not survive deployment to Vercel / Cloudflare Pages.
//
// Live snapshot — copied from `<repo>/data/snapshot.json` if present.
const SNAPSHOT_PATH = path.resolve(process.cwd(), "data", "snapshot.json");
// Frozen reference snapshot, tracked in git at `<repo>/data/snapshot.example.json`
// and copied in alongside the live one. Lets the UI render even when no live
// scrape has been run yet.
const EXAMPLE_SNAPSHOT_PATH = path.resolve(
  process.cwd(), "data", "snapshot.example.json"
);
// Compact per-listing history summary — copied in from
// `<repo>/data/history/summary.json` by `copy-snapshot.mjs`. Optional: a fresh
// clone (or a deploy before the first backfill) simply has no history overlay.
const HISTORY_SUMMARY_PATH = path.resolve(
  process.cwd(), "data", "history-summary.json"
);

export class SnapshotParseError extends Error {
  constructor(path: string, cause: unknown) {
    super(`Could not parse snapshot at ${path}: ${(cause as Error)?.message ?? cause}`);
    this.name = "SnapshotParseError";
    this.cause = cause;
  }
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  for (const candidate of [SNAPSHOT_PATH, EXAMPLE_SNAPSHOT_PATH]) {
    let raw: string;
    try {
      raw = await readFile(candidate, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    try {
      return JSON.parse(raw) as Snapshot;
    } catch (err) {
      // Distinguish "missing file" (fall through) from "file present but
      // malformed" — the latter is a real bug and should surface, not
      // silently fall back to the example seed.
      throw new SnapshotParseError(candidate, err);
    }
  }
  return null;
}

/** Load the per-listing history summary, keyed by listing `url`. History is a
 * nice-to-have overlay on top of the snapshot, so a missing OR malformed file
 * degrades gracefully to "no history" ({}) rather than taking down the page. */
export async function loadHistorySummary(): Promise<HistorySummary> {
  let raw: string;
  try {
    raw = await readFile(HISTORY_SUMMARY_PATH, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    return JSON.parse(raw) as HistorySummary;
  } catch {
    return {};
  }
}
