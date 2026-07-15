// Emit the public read-only JSON API under `public/api/v1/` at build time:
//
//   /api/v1/meta.json                                  — version, snapshot time, counts, endpoint index
//   /api/v1/motors.json                                — every motor we have a listing for (clean schema)
//   /api/v1/in-stock.json                              — same shape, only motors in stock somewhere
//   /api/v1/vendors.json                               — the vendors we track + per-vendor counts
//   /api/v1/motors/<manufacturer>/<designation>.json   — one motor (mirrors the site's /motor URL)
//   /api/v1/openapi.json                               — OpenAPI 3.1 spec for the above
//
// These are STATIC assets served by Cloudflare Pages (unlimited requests +
// bandwidth, free, global CDN), so the API has no rate limit and no per-request
// cost — it refreshes on the hourly deploy like the rest of the site. CORS +
// cache headers are set for `/api/*` in public/_headers. See docs/api.md.
//
// The motor → public-shape mapping lives here (buildApi/toPublicMotor) and is
// unit-tested via lib/publicApi.test.ts (which imports these exports), so the
// public contract is guarded. The in-stock / pack / hazmat / slug helpers come
// from ./derive-shared.mjs — the single script-side mirror of lib/derive.ts +
// lib/pack.ts, pinned to them by lib/scriptParity.test.ts.
//
// Runs in `prebuild` after copy-snapshot.mjs. Idempotent.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cheapestInStockListing,
  designationToSlug,
  hazmatStatus,
  listingInStock,
  manufacturerSlug,
  packSize,
  unitPriceCents,
} from "./derive-shared.mjs";

export const SCHEMA_VERSION = 1;
const MIN_CLASS = "D"; // match the site's catalog floor (mirror lib/derive MIN_CLASS)
const SITE_URL = "https://motor.fusionspace.co";

// Re-exported for lib/publicApi.test.ts, which imports these from this module.
export { designationToSlug, hazmatStatus, manufacturerSlug };

/** Per-motor API path (relative to public/), mirroring the site URL + OG path. */
export function motorApiPath(motor) {
  return `motors/${manufacturerSlug(motor.manufacturer)}/${designationToSlug(motor.designation)}.json`;
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
  const raw = m.listings ?? [];
  const listings = raw.map(toPublicListing);
  const inStockRaw = raw.filter((l) => listingInStock(l.status));
  const cheapest = cheapestInStockListing(m);
  return {
    id: m.id,
    path: `/api/v1/${motorApiPath(m)}`, // this motor's own endpoint
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
    hazmat: hazmatStatus(m), // "required" | "varies" | "none" (DOT 62.5g rule)
    delays: m.delays ?? null,
    delay_adjustable: m.delay_adjustable ?? false,
    discontinued: m.discontinued ?? false,
    in_stock: inStockRaw.length > 0,
    // Distinct VENDORS (deduped by slug) — a vendor that lists several variants
    // of the same motor (delays, pack sizes) must not inflate the vendor count.
    vendor_count: new Set(raw.map((l) => l.vendor_slug)).size,
    in_stock_vendor_count: new Set(inStockRaw.map((l) => l.vendor_slug)).size,
    listing_count: listings.length, // total individual listings/variants
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
  // Count DISTINCT motors per vendor (and distinct in-stock motors) — a vendor
  // that lists several variants of one motor must count it once, not per listing.
  const names = new Map();
  const motorCount = new Map();
  const inStockCount = new Map();
  const bump = (map, slug) => map.set(slug, (map.get(slug) ?? 0) + 1);
  for (const m of motors) {
    const all = new Set();
    const inStock = new Set();
    for (const l of m.listings ?? []) {
      names.set(l.vendor_slug, l.vendor_name);
      all.add(l.vendor_slug);
      if (listingInStock(l.status)) inStock.add(l.vendor_slug);
    }
    for (const slug of all) bump(motorCount, slug);
    for (const slug of inStock) bump(inStockCount, slug);
  }
  return [...names.keys()]
    .map((slug) => ({
      slug,
      name: names.get(slug),
      motor_count: motorCount.get(slug) ?? 0, // distinct motors carried
      in_stock_count: inStockCount.get(slug) ?? 0, // distinct motors in stock
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Build the full set of public API payloads from a snapshot. Pure (no I/O). */
export function buildApi(snapshot) {
  const generatedAt = snapshot?.generated_at ?? null;
  // Every matched motor with a listing, at or above the site's class floor — a
  // stray sub-D matched motor would otherwise appear in the API but never on the
  // site.
  const source = (snapshot?.motors ?? []).filter(
    (m) => (m.listings?.length ?? 0) > 0 && (m.impulse_class ?? "") >= MIN_CLASS,
  );
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
      motor: "/api/v1/motors/{manufacturer}/{designation}.json",
      openapi: "/api/v1/openapi.json",
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
    // One payload per motor, written to its slug path; wrapped like the others.
    perMotor: motors.map((m) => ({ path: motorApiPath(m), payload: { ...stamp, motor: m } })),
    openapi: buildOpenApi(),
  };
}

/** Normalize an ISO-8601 instant to the "…Z" UTC spelling at second precision.
 * The snapshot stamps generated_at as "+00:00"; Muster's feed advertises plain
 * "…Z" (matching its documented example). Null/unparseable passes through. */
export function isoUtcZ(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Compact BULK availability feed, written to the site root as /availability.json.
 * Built for Muster (muster.fusionspace.co), which badges rocket-motor hardware
 * compatibility and links here for stock: reading one small static file lets it
 * badge a whole list ("in stock now · N vendors") from a single fetch, instead of
 * a ~110 KB page load per motor to read that motor's schema.org AggregateOffer.
 *
 * A flat map of "<manufacturer-slug>/<designation>" → { vendors, inStock } over
 * the SAME motor set the public API emits (listed, class D+), so every key lines
 * up with a real /motor/<mfr>/<designation> page and the counts match /api/v1:
 *   vendors = distinct vendors listing the motor          (API vendor_count)
 *   inStock = distinct vendors with it in stock right now  (in_stock_vendor_count)
 * Summary only — no prices (Muster shows availability, not price).
 *
 * Keys use the designation VERBATIM (as ThrustCurve spells it, and as Muster has
 * it). A few AeroTech designations contain "/", which the site URL encodes as "~"
 * (designationToSlug); for those we ALSO emit the "~" spelling as an alias, so a
 * lookup by either the raw designation or the exact page-URL path resolves. No
 * designation contains "~", so the two spellings never collide.
 *
 * Takes the already-built `api` (from buildApi) to reuse its tested filter +
 * distinct-vendor counts — no separate motor walk to drift out of sync. Pure.
 */
export function buildAvailability(api) {
  const motors = {};
  for (const m of api.motors.motors) {
    const mfr = manufacturerSlug(m.manufacturer);
    const summary = { vendors: m.vendor_count, inStock: m.in_stock_vendor_count };
    motors[`${mfr}/${m.designation}`] = summary;
    const slug = designationToSlug(m.designation);
    if (slug !== m.designation) motors[`${mfr}/${slug}`] = summary;
  }
  return { _generated: isoUtcZ(api.motors.generated_at), motors };
}

/** A small OpenAPI 3.1 document describing the endpoints + schemas. */
export function buildOpenApi() {
  const listing = {
    type: "object",
    properties: {
      vendor: { type: "string" },
      vendor_slug: { type: "string" },
      url: { type: "string", format: "uri" },
      status: { type: "string", enum: ["in_stock", "out_of_stock", "special_order", "unknown"] },
      price_cents: { type: ["integer", "null"], description: "sticker price in cents" },
      unit_price_cents: { type: ["integer", "null"], description: "price ÷ pack_size" },
      currency: { type: "string" },
      pack_size: { type: "integer", description: "1 = single" },
      stock_count: { type: ["integer", "null"] },
      lead_time: { type: ["string", "null"] },
      last_seen: { type: "string", format: "date-time" },
    },
  };
  const motor = {
    type: "object",
    properties: {
      id: { type: "integer" },
      path: { type: "string", description: "this motor's own /api/v1 endpoint" },
      manufacturer: { type: "string", enum: ["AeroTech", "Cesaroni Technology", "Loki Research"] },
      designation: { type: "string" },
      common_name: { type: ["string", "null"] },
      impulse_class: { type: "string", description: "single letter, D–O" },
      diameter_mm: { type: "integer" },
      total_impulse_ns: { type: ["number", "null"] },
      avg_thrust_n: { type: ["number", "null"] },
      burn_time_s: { type: ["number", "null"] },
      propellant: { type: ["string", "null"] },
      sparky: { type: "boolean" },
      motor_type: { type: ["string", "null"], description: "reload | SU | hybrid" },
      case_info: { type: ["string", "null"] },
      hazmat: {
        type: "string",
        enum: ["required", "varies", "none"],
        description:
          "DOT hazmat-shipping status derived from propellant weight: required (>62.5g or H+), varies (F/G near the limit — vendor-dependent), none (<=62.5g, A-E)",
      },
      delays: { type: ["string", "null"] },
      delay_adjustable: { type: "boolean" },
      discontinued: { type: "boolean" },
      in_stock: { type: "boolean" },
      vendor_count: { type: "integer", description: "distinct vendors carrying it" },
      in_stock_vendor_count: { type: "integer" },
      listing_count: { type: "integer", description: "total individual listings/variants" },
      cheapest_in_stock: { anyOf: [{ type: "null" }, { $ref: "#/components/schemas/CheapestInStock" }] },
      listings: { type: "array", items: { $ref: "#/components/schemas/Listing" } },
    },
  };
  const stamped = (extra) => ({
    type: "object",
    properties: {
      schema_version: { type: "integer" },
      generated_at: { type: "string", format: "date-time" },
      ...extra,
    },
  });
  const notFound = { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
  const ok = (ref) => ({
    "200": { description: "OK", content: { "application/json": { schema: { $ref: ref } } } },
    "404": notFound,
  });
  const op = (operationId, summary, ref, extra = {}) => ({ operationId, summary, responses: ok(ref), ...extra });
  return {
    openapi: "3.1.0",
    info: {
      title: "HPR Motor Finder API",
      version: `${SCHEMA_VERSION}.0.0`,
      description:
        "Free, read-only JSON of U.S. high-power rocket motor stock & pricing (AeroTech, " +
        "Cesaroni, Loki). Static files on a CDN — no key, no rate limit, CORS-open, refreshed ~hourly.",
      license: { name: "Free to use; attribution appreciated; provided as-is", url: `${SITE_URL}/api` },
    },
    servers: [{ url: `${SITE_URL}/api/v1` }],
    paths: {
      "/meta.json": { get: op("getMeta", "Schema version, generated_at, counts, endpoints", "#/components/schemas/Meta") },
      "/motors.json": { get: op("listMotors", "Every motor we have a listing for", "#/components/schemas/MotorList") },
      "/in-stock.json": { get: op("listInStockMotors", "Only motors in stock somewhere", "#/components/schemas/MotorList") },
      "/vendors.json": { get: op("listVendors", "Vendors tracked + per-vendor counts", "#/components/schemas/VendorList") },
      "/motors/{manufacturer}/{designation}.json": {
        get: op("getMotor", "A single motor (slugs mirror the site /motor URL, e.g. aerotech/H128W)", "#/components/schemas/MotorResponse", {
          parameters: [
            { name: "manufacturer", in: "path", required: true, schema: { type: "string", enum: ["aerotech", "cesaroni", "loki"] } },
            { name: "designation", in: "path", required: true, schema: { type: "string" }, description: "'/' is encoded as '~'" },
          ],
        }),
      },
    },
    components: {
      schemas: {
        Listing: listing,
        CheapestInStock: {
          type: "object",
          description: "The pack-aware cheapest in-stock listing (per unit).",
          properties: {
            price_cents: { type: ["integer", "null"] },
            unit_price_cents: { type: ["integer", "null"] },
            currency: { type: "string" },
            vendor: { type: "string" },
            vendor_slug: { type: "string" },
            url: { type: "string", format: "uri" },
            pack_size: { type: "integer" },
          },
        },
        Motor: motor,
        Vendor: {
          type: "object",
          properties: {
            slug: { type: "string" },
            name: { type: "string" },
            motor_count: { type: "integer" },
            in_stock_count: { type: "integer" },
          },
        },
        Meta: stamped({
          counts: { type: "object" },
          manufacturers: { type: "array", items: { type: "string" } },
          endpoints: { type: "object" },
        }),
        MotorList: stamped({
          count: { type: "integer" },
          motors: { type: "array", items: { $ref: "#/components/schemas/Motor" } },
        }),
        VendorList: stamped({
          count: { type: "integer" },
          vendors: { type: "array", items: { $ref: "#/components/schemas/Vendor" } },
        }),
        MotorResponse: stamped({ motor: { $ref: "#/components/schemas/Motor" } }),
        Error: { type: "object", properties: { error: { type: "string" } } },
      },
    },
  };
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = resolve(here, "..", "data");
  const publicDir = resolve(here, "..", "public");
  const outDir = resolve(publicDir, "api", "v1");
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
  // Bulk availability feed at the site root (Muster reads this cross-origin; CORS
  // for /availability.json is set in public/_headers). Written from the same api.
  const availability = buildAvailability(api);
  await writeFile(resolve(publicDir, "availability.json"), JSON.stringify(availability));
  await writeFile(resolve(outDir, "meta.json"), JSON.stringify(api.meta));
  await writeFile(resolve(outDir, "motors.json"), JSON.stringify(api.motors));
  await writeFile(resolve(outDir, "in-stock.json"), JSON.stringify(api.inStock));
  await writeFile(resolve(outDir, "vendors.json"), JSON.stringify(api.vendors));
  await writeFile(resolve(outDir, "openapi.json"), JSON.stringify(api.openapi));
  // Per-motor files (one dir per manufacturer slug).
  const madeDirs = new Set();
  for (const { path, payload } of api.perMotor) {
    const abs = resolve(outDir, path);
    const dir = dirname(abs);
    if (!madeDirs.has(dir)) {
      await mkdir(dir, { recursive: true });
      madeDirs.add(dir);
    }
    await writeFile(abs, JSON.stringify(payload));
  }
  console.log(
    `gen-api: wrote meta/motors/in-stock/vendors/openapi + ${api.perMotor.length} per-motor files ` +
      `+ availability.json (${Object.keys(availability.motors).length} keys) ` +
      `(${api.meta.counts.motors} motors, ${api.meta.counts.in_stock} in stock, ${api.meta.counts.vendors} vendors)`,
  );
}

// Only run the file-writing step when executed directly (`node scripts/gen-api.mjs`),
// not when imported by the test.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
