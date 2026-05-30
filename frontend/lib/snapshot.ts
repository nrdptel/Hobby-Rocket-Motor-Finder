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
  diameter_mm: number;
  impulse_class: string;
  total_impulse_ns: number | null;
  avg_thrust_n: number | null;
  burn_time_s: number | null;
  propellant: string | null;
  listings: Listing[];
};

export type Snapshot = {
  generated_at: string;
  motors: Motor[];
};

const SNAPSHOT_PATH = path.resolve(process.cwd(), "..", "data", "snapshot.json");

export async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    const raw = await readFile(SNAPSHOT_PATH, "utf-8");
    return JSON.parse(raw) as Snapshot;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
