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

// Live snapshot (gitignored — produced by `hpr snapshot export` or by CI).
const SNAPSHOT_PATH = path.resolve(process.cwd(), "..", "data", "snapshot.json");
// Frozen reference snapshot (tracked in git). Lets `npm run dev` work without
// running scrapers first — handy for new contributors and for CI build steps
// where the live snapshot hasn't been generated yet.
const EXAMPLE_SNAPSHOT_PATH = path.resolve(
  process.cwd(), "..", "data", "snapshot.example.json"
);

export async function loadSnapshot(): Promise<Snapshot | null> {
  for (const candidate of [SNAPSHOT_PATH, EXAMPLE_SNAPSHOT_PATH]) {
    try {
      const raw = await readFile(candidate, "utf-8");
      return JSON.parse(raw) as Snapshot;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  return null;
}
