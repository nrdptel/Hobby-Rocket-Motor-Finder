// Emit the public read-only JSON API under `public/api/v1/` at build time:
//
//   /api/v1/meta.json       — schema version, snapshot time, counts, endpoint list
//   /api/v1/motors.json     — every matched motor we have listings for (clean schema)
//   /api/v1/in-stock.json   — same shape, only motors in stock somewhere
//   /api/v1/vendors.json    — the vendors we track + per-vendor counts
//
// These are STATIC assets served by Cloudflare Pages (unlimited requests +
// bandwidth, free, global CDN), so the API has no rate limit and no per-request
// cost — it refreshes on the hourly deploy like the rest of the site. CORS +
// cache headers are set for `/api/*` in public/_headers. See docs/api.md.
//
// The motor → public-shape mapping lives here (buildApi/toPublicMotor) and is
// unit-tested via lib/publicApi.test.ts (which imports these exports), so the
// public contract is guarded. The small in-stock/pack helpers mirror lib/derive
// + lib/pack (kept in sync; same inlined copy gen-og.mjs uses).
//
// Runs in `prebuild` after copy-snapshot.mjs. Idempotent.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 1;

// --- inlined in-stock / pack helpers (mirror lib/derive.ts + lib/pack.ts) ---
const IN_STOCK = new Set(["in_stock", "in_stock_with_count"]);
const listingInStock = (status) => IN_STOCK.has(status);
const MAX_PACK = 24;
function packFromUrl(url) {
  const m = /(\d+)\s*[- ]?\s*pack/i.exec(url || "");
  if (m) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n >= 2 && n <= MAX_PACK) return n;
  }
  return 1;
}
function packSize(l) {
  const ps = l.pack_size;
  if (ps != null) return Number.isInteger(ps) && ps >= 2 && ps <= MAX_PACK ? ps : 1;
  return packFromUrl(l.url ?? "");
}
function unitPriceCents(priceCents, l) {
  if (priceCents == null) return null;
  const n = packSize(l);
  return n > 1 ? Math.round(priceCents / n) : priceCents;
}
function cheapestInStockListing(m) {
  let best = null;
  let bestUnit = Number.POSITIVE_INFINITY;
  for (const l of m.listings) {
    if (!listingInStock(l.status)) continue;
    const unit = unitPriceCents(l.price_cents, l);
    if (unit == null) continue;
    if (unit < bestUnit) {
      best = l;
      bestUnit = unit;
    }
  }
  return best ?? m.listings.find((l) => listingInStock(l.status)) ?? null;
}

// Collapse the internal `in_stock_with_count` into a plain `in_stock` for the
// public contract; the count lives in `stock_count` instead. The other states
// pass through unchanged.
function publicStatus(status) {
  return status === "in_stock_with_count" ? "in_stock" : status;
}

function toPublicListing(l) {
  return {
    vendor: l.vendor_name,
    vendor_slug: l.vendor_slug,
    url: l.url,
    status: publicStatus(l.status),
    price_cents: l.price_cents ?? null,
    unit_price_cents: unitPriceCents(l.price_cents ?? null, l),
    currency: l.currency,
    pack_size: packSize(l),
    stock_count: l.stock_count ?? null,
    lead_time: l.lead_time ?? null,
    last_seen: l.seen_at,
  };
}

/** Project an internal snapshot motor down to the stable public schema. */
export function toPublicMotor(m) {
  const listings = (m.listings ?? []).map(toPublicListing);
  const inStockListings = (m.listings ?? []).filter((l) => listingInStock(l.status));
  const cheapest = cheapestInStockListing(m);
  return {
    id: m.id,
    manufacturer: m.manufacturer,
    designation: m.designation,
    common_name: m.common_name ?? null,
    impulse_class: m.impulse_class,
    diameter_mm: m.diameter_mm,
    total_impulse_ns: m.total_impulse_ns ?? null,
    avg_thrust_n: m.avg_thrust_n ?? null,
    burn_time_s: m.burn_time_s ?? null,
    propellant: m.propellant ?? null,
    sparky: m.sparky ?? false,
    motor_type: m.motor_type ?? null,
    case_info: m.case_info ?? null,
    delays: m.delays ?? null,
    delay_adjustable: m.delay_adjustable ?? false,
    discontinued: m.discontinued ?? false,
    in_stock: inStockListings.length > 0,
    vendor_count: listings.length,
    in_stock_vendor_count: inStockListings.length,
    cheapest_in_stock: cheapest
      ? {
          price_cents: cheapest.price_cents ?? null,
          unit_price_cents: unitPriceCents(cheapest.price_cents ?? null, cheapest),
          currency: cheapest.currency,
          vendor: cheapest.vendor_name,
          vendor_slug: cheapest.vendor_slug,
          url: cheapest.url,
          pack_size: packSize(cheapest),
        }
      : null,
    listings,
  };
}

function buildVendors(motors) {
  const bySlug = new Map();
  for (const m of motors) {
    for (const l of m.listings ?? []) {
      let v = bySlug.get(l.vendor_slug);
      if (!v) {
        v = { slug: l.vendor_slug, name: l.vendor_name, motor_count: 0, in_stock_count: 0 };
        bySlug.set(l.vendor_slug, v);
      }
      v.motor_count += 1;
      if (listingInStock(l.status)) v.in_stock_count += 1;
    }
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Build the full set of public API payloads from a snapshot. Pure (no I/O). */
export function buildApi(snapshot) {
  const generatedAt = snapshot?.generated_at ?? null;
  // Every matched motor we actually have a listing for (all impulse classes —
  // the API is the complete dataset, not the D+ UI view).
  const source = (snapshot?.motors ?? []).filter((m) => (m.listings?.length ?? 0) > 0);
  const motors = source.map(toPublicMotor);
  const inStock = motors.filter((m) => m.in_stock);
  const vendors = buildVendors(source);
  const manufacturers = [...new Set(motors.map((m) => m.manufacturer))].sort();

  const stamp = { schema_version: SCHEMA_VERSION, generated_at: generatedAt };
  const meta = {
    ...stamp,
    counts: { motors: motors.length, in_stock: inStock.length, vendors: vendors.length },
    manufacturers,
    endpoints: {
      meta: "/api/v1/meta.json",
      motors: "/api/v1/motors.json",
      in_stock: "/api/v1/in-stock.json",
      vendors: "/api/v1/vendors.json",
    },
    docs: "https://github.com/nrdptel/Hobby-Rocket-Motor-Finder/blob/main/docs/api.md",
    license:
      "Free to use; attribution to motor.fusionspace.co appreciated. " +
      "Aggregated from public vendor listings + ThrustCurve; provided as-is, no warranty.",
    notes: "Static JSON, refreshed ~hourly. CORS-enabled (Access-Control-Allow-Origin: *). No rate limits.",
  };
  return {
    meta,
    motors: { ...stamp, count: motors.length, motors },
    inStock: { ...stamp, count: inStock.length, motors: inStock },
    vendors: { ...stamp, count: vendors.length, vendors },
  };
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = resolve(here, "..", "data");
  const outDir = resolve(here, "..", "public", "api", "v1");
  const readJson = async (name) => {
    try {
      return JSON.parse(await readFile(resolve(dataDir, name), "utf-8"));
    } catch {
      return null;
    }
  };
  const snapshot = (await readJson("snapshot.json")) ?? (await readJson("snapshot.example.json")) ?? {
    generated_at: null,
    motors: [],
  };
  const api = buildApi(snapshot);
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "meta.json"), JSON.stringify(api.meta));
  await writeFile(resolve(outDir, "motors.json"), JSON.stringify(api.motors));
  await writeFile(resolve(outDir, "in-stock.json"), JSON.stringify(api.inStock));
  await writeFile(resolve(outDir, "vendors.json"), JSON.stringify(api.vendors));
  console.log(
    `gen-api: wrote public/api/v1/{meta,motors,in-stock,vendors}.json ` +
      `(${api.meta.counts.motors} motors, ${api.meta.counts.in_stock} in stock, ${api.meta.counts.vendors} vendors)`,
  );
}

// Only run the file-writing step when executed directly (`node scripts/gen-api.mjs`),
// not when imported by the test.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
