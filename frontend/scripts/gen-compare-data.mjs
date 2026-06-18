// Emit `public/compare-data.json`: a compact, per-motor payload the BROWSER can
// fetch to render /compare/<ids> client-side. Under the static-export hosting
// migration the compare page can no longer read fs at request time (it used to
// be a server component), so the catalog data it needs is baked into a small
// static JSON at build time and resolved in the browser instead.
//
// The motor universe and ids MUST match `mergedCatalog(...MIN_CLASS)` exactly —
// that's the universe the catalog UI builds compare links from (URL ids are real
// DB ids for stocked motors and deterministic NEGATIVE hashes for "phantoms").
// So this script re-implements the small slice of lib/catalogMotors.ts +
// lib/curves.ts it needs (pure logic, no fs-bound TS imports), keeping it a plain
// node .mjs like copy-snapshot.mjs. If that merge logic changes, update both.
//
// Runs as part of `prebuild`/`predev` (after copy-snapshot.mjs). Idempotent.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "..", "data");
const outPath = resolve(here, "..", "public", "compare-data.json");

const MIN_CLASS = "D"; // mirror lib/derive MIN_CLASS

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(resolve(dataDir, name), "utf-8"));
  } catch {
    return fallback;
  }
}

// --- mirror lib/catalogMotors.ts -------------------------------------------
function motorKey(manufacturer, designation) {
  return `${manufacturer.toLowerCase()}|${designation}`;
}
function phantomId(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return -(Math.abs(h) + 1);
}
function toPhantom(c) {
  return {
    id: phantomId(motorKey(c.manufacturer, c.designation)),
    manufacturer: c.manufacturer,
    designation: c.designation,
    diameter_mm: c.diameter,
    impulse_class: c.impulseClass,
    total_impulse_ns: c.totImpulseNs ?? null,
    avg_thrust_n: c.avgThrustN ?? null,
    burn_time_s: c.burnTimeS ?? null,
    propellant: c.propInfo ?? null,
    motor_type: c.type ?? null,
    case_info: c.caseInfo ?? null,
    prop_weight_g: c.propWeightG ?? null,
    listings: [],
  };
}

// --- mirror lib/curves.ts curveKey -----------------------------------------
function curveKey(manufacturer, designation) {
  return `${manufacturer}|${designation}`;
}

// Project a snapshot/phantom motor down to ONLY the fields CompareView +
// ComparePageBody read (see those components). Listings are trimmed to the
// fields cheapestInStockListing / unitPriceCents / bestBuy touch, so the payload
// stays small but the existing CompareView renders unchanged on the client.
function compactMotor(m) {
  return {
    id: m.id,
    manufacturer: m.manufacturer,
    designation: m.designation,
    diameter_mm: m.diameter_mm,
    impulse_class: m.impulse_class,
    total_impulse_ns: m.total_impulse_ns ?? null,
    avg_thrust_n: m.avg_thrust_n ?? null,
    burn_time_s: m.burn_time_s ?? null,
    propellant: m.propellant ?? null,
    motor_type: m.motor_type ?? null,
    case_info: m.case_info ?? null,
    prop_weight_g: m.prop_weight_g ?? null,
    listings: (m.listings ?? []).map((l) => ({
      vendor_name: l.vendor_name,
      url: l.url,
      price_cents: l.price_cents ?? null,
      currency: l.currency,
      status: l.status,
      ...(l.pack_size != null ? { pack_size: l.pack_size } : {}),
    })),
  };
}

const snapshot =
  (await readJson("snapshot.json", null)) ?? (await readJson("snapshot.example.json", null));
const catalog = [
  ...(await readJson("thrustcurve_aerotech.json", [])),
  ...(await readJson("thrustcurve_cesaroni.json", [])),
  ...(await readJson("thrustcurve_loki.json", [])),
];
const curves = await readJson("curves.json", {});

await mkdir(dirname(outPath), { recursive: true });

if (!snapshot) {
  // No snapshot at all (fresh clone with neither live nor example seed) → emit an
  // empty payload so the client fetch still 200s and shows the empty-state shell.
  await writeFile(outPath, JSON.stringify({ motors: {}, curves: {} }));
  console.log("gen-compare-data: no snapshot, wrote empty compare-data.json");
  process.exit(0);
}

// mergedCatalog(...MIN_CLASS): stocked (has listing + class>=MIN) + phantoms.
const stocked = snapshot.motors.filter(
  (m) => m.listings.length > 0 && m.impulse_class >= MIN_CLASS,
);
const stockedKeys = new Set(stocked.map((m) => motorKey(m.manufacturer, m.designation)));
const phantoms = [];
const seen = new Set();
for (const c of catalog) {
  if (!c.impulseClass || c.impulseClass[0] < MIN_CLASS) continue;
  const key = motorKey(c.manufacturer, c.designation);
  if (stockedKeys.has(key) || seen.has(key)) continue;
  seen.add(key);
  phantoms.push(toPhantom(c));
}
const all = [...stocked, ...phantoms];

// motors: id -> compact motor; curvesByKey is keyed by manufacturer|designation
// (curveKey) so the client can attach an overlay series per resolved motor.
const motors = {};
const curveOut = {};
for (const m of all) {
  motors[m.id] = compactMotor(m);
  const ck = curveKey(m.manufacturer, m.designation);
  if (!(ck in curveOut) && curves[ck]) curveOut[ck] = curves[ck];
}

await writeFile(outPath, JSON.stringify({ motors, curves: curveOut }));
console.log(
  `gen-compare-data: wrote ${Object.keys(motors).length} motors, ` +
    `${Object.keys(curveOut).length} curves → public/compare-data.json`,
);
