// "Phantom" motors: real ThrustCurve catalog motors (AeroTech / Cesaroni / Loki,
// D and up) that NO tracked vendor currently stocks. The catalog shows only
// motors someone sells; this lets a flyer who searches a real motor land on an
// honest "not sold anywhere we track — here's the nearest buyable swap" instead
// of an empty result. The catalog JSONs (data/thrustcurve_*.json) are the same
// source the backend matched listings against, so designations line up exactly.

import type { Motor } from "./snapshot";

// The subset of catalog fields we map onto a Motor.
export type CatalogRecord = {
  manufacturer: string;
  designation: string;
  commonName?: string | null;
  diameter: number;
  impulseClass: string;
  totImpulseNs?: number | null;
  avgThrustN?: number | null;
  burnTimeS?: number | null;
  propInfo?: string | null;
  delays?: string | null;
  delayAdjustable?: boolean;
  type?: string | null; // "reload" | "SU" | "hybrid"
  caseInfo?: string | null;
  availability?: string; // "regular" | "OOP"
};

/** Dedup key matching the snapshot's motors (same manufacturer + designation). */
export function motorKey(manufacturer: string, designation: string): string {
  return `${manufacturer.toLowerCase()}|${designation}`;
}

// Stable NEGATIVE id for a phantom (real motor ids are small positive DB ints),
// so phantoms never collide and React keys / the watchlist treat them like any
// motor. Derived from the key, so it's deterministic across loads.
function phantomId(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return -(Math.abs(h) + 1);
}

function toPhantom(c: CatalogRecord): Motor {
  return {
    id: phantomId(motorKey(c.manufacturer, c.designation)),
    manufacturer: c.manufacturer,
    designation: c.designation,
    common_name: c.commonName ?? undefined,
    diameter_mm: c.diameter,
    impulse_class: c.impulseClass,
    total_impulse_ns: c.totImpulseNs ?? null,
    avg_thrust_n: c.avgThrustN ?? null,
    burn_time_s: c.burnTimeS ?? null,
    propellant: c.propInfo ?? null,
    delays: c.delays ?? null,
    delay_adjustable: !!c.delayAdjustable,
    discontinued: (c.availability || "") === "OOP",
    motor_type: c.type ?? null,
    case_info: c.caseInfo ?? null,
    listings: [],
  };
}

/** A motor is a "phantom" iff it carries no listings. */
export function isPhantom(m: Motor): boolean {
  return m.listings.length === 0;
}

/** Every catalog motor of class >= minClass that ISN'T already stocked, as a
 * Motor with empty listings. `stockedKeys` comes from the snapshot via motorKey. */
export function phantomMotors(
  records: readonly CatalogRecord[],
  stockedKeys: ReadonlySet<string>,
  minClass: string,
): Motor[] {
  const out: Motor[] = [];
  const seen = new Set<string>();
  for (const c of records) {
    if (!c.impulseClass || c.impulseClass[0] < minClass) continue;
    const key = motorKey(c.manufacturer, c.designation);
    if (stockedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(toPhantom(c));
  }
  return out;
}

/** The full catalog universe shown to a flyer: every stocked motor (class >=
 * minClass, with a listing) plus every D+ phantom. */
export function mergedCatalog(
  snapshotMotors: readonly Motor[],
  catalogRecords: readonly CatalogRecord[],
  minClass: string,
): Motor[] {
  const stocked = snapshotMotors.filter(
    (m) => m.listings.length > 0 && m.impulse_class >= minClass,
  );
  const stockedKeys = new Set(stocked.map((m) => motorKey(m.manufacturer, m.designation)));
  return [...stocked, ...phantomMotors(catalogRecords, stockedKeys, minClass)];
}
