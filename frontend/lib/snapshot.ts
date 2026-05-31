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
