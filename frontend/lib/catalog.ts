// Pure catalog filter/sort/group pipeline, extracted verbatim from the original
// server-side render in app/page.tsx so it can run identically in the browser
// (instant client-side filtering). No React, no DOM — server- and client-safe.
//
// CatalogParams holds the RAW filter values (cert is NOT pre-expanded to classes;
// that happens inside filterCatalog) so the same struct round-trips to the URL.

import {
  burnCharacter,
  caseKey,
  certClasses,
  findSubstitutes,
  groupByDelay,
  listingInStock,
  manufacturerLabel,
  motorInStock,
  parseDir,
  parseOrder,
  sortedMotors,
  toSubstitute,
  type GroupedMotor,
  type ListingSort,
  type MotorOrder,
  type SortDir,
  type Substitute,
} from "./derive";
import type { Motor } from "./snapshot";

export type CatalogParams = {
  mfr: Set<string>;
  cls: Set<string>;
  dia: Set<string>;
  cert: Set<string>; // raw cert keys (mid/l1/l2/l3); expanded to classes at filter time
  cases: Set<string>;
  props: Set<string>;
  vendors: Set<string>;
  burn: Set<string>; // burn-character keys: "punchy" | "standard" | "long"
  sparky: boolean; // only sparky (metal-additive) propellant motors
  inStock: boolean;
  listingSort: ListingSort; // ?sort=price → cheapest listing first within a motor
  order: MotorOrder;
  dir: SortDir;
  starredOnly: boolean;
  query: string; // already trimmed + lowercased
  minImpulse: number | null;
  maxImpulse: number | null;
};

function setParam(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(",").filter(Boolean));
}

function numParam(raw: string | undefined): number | null {
  const n = raw != null && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Parse catalog filter params from any single-value getter — `URLSearchParams.get`
 * on the client, or a Record accessor on the server. Mirrors the original
 * app/page.tsx parsing exactly. */
export function parseCatalogParams(get: (key: string) => string | undefined): CatalogParams {
  return {
    mfr: setParam(get("mfr")),
    cls: setParam(get("class")),
    dia: setParam(get("dia")),
    cert: setParam(get("cert")),
    cases: setParam(get("case")),
    props: setParam(get("prop")),
    vendors: setParam(get("vendor")),
    burn: setParam(get("burn")),
    sparky: get("sparky") === "1",
    inStock: get("in_stock") === "1",
    listingSort: get("sort") === "price" ? "price" : "stock",
    order: parseOrder(get("order")),
    dir: parseDir(get("dir")),
    starredOnly: get("starred") === "1",
    query: (get("q") ?? "").trim().toLowerCase(),
    minImpulse: numParam(get("imin")),
    maxImpulse: numParam(get("imax")),
  };
}

/** Filter + sort the catalog. Verbatim from the original page.tsx predicate. */
export function filterCatalog(motors: readonly Motor[], p: CatalogParams): Motor[] {
  const certCls = certClasses(p.cert);
  return sortedMotors(
    motors.filter((m) => {
      if (p.mfr.size > 0 && !p.mfr.has(manufacturerLabel(m.manufacturer))) return false;
      if (p.cls.size > 0 && !p.cls.has(m.impulse_class)) return false;
      if (certCls.size > 0 && !certCls.has(m.impulse_class)) return false;
      if (p.dia.size > 0 && !p.dia.has(String(m.diameter_mm))) return false;
      if (p.cases.size > 0) {
        const k = caseKey(m);
        if (k == null || !p.cases.has(k)) return false;
      }
      if (p.props.size > 0 && !(m.propellant && p.props.has(m.propellant))) return false;
      if (p.sparky && !m.sparky) return false;
      if (p.burn.size > 0) {
        const bc = burnCharacter(m);
        if (bc == null || !p.burn.has(bc)) return false;
      }
      if (p.vendors.size > 0 && !m.listings.some((l) => p.vendors.has(l.vendor_slug))) return false;
      if (p.minImpulse != null && (m.total_impulse_ns == null || m.total_impulse_ns < p.minImpulse))
        return false;
      if (p.maxImpulse != null && (m.total_impulse_ns == null || m.total_impulse_ns > p.maxImpulse))
        return false;
      if (p.inStock && !m.listings.some((l) => listingInStock(l.status))) return false;
      if (p.query) {
        const designationHit = m.designation.toLowerCase().includes(p.query);
        const commonHit = (m.common_name ?? "").toLowerCase().includes(p.query);
        const varietyHit = m.listings.some((l) =>
          (l.raw_designation ?? "").toLowerCase().includes(p.query),
        );
        if (!designationHit && !commonHit && !varietyHit) return false;
      }
      return true;
    }),
    p.order,
    p.dir,
  );
}

export type CatalogView = {
  motors: GroupedMotor[];
  substitutes: Record<number, Substitute[]>;
};

/** The full render-ready view: filtered + sorted, listings trimmed to in-stock
 * when that toggle is on, grouped by delay, plus per-sold-out-motor substitutes.
 * Verbatim from app/page.tsx (filteredWithListings + substitutes). `allMotors` is
 * the unfiltered motors-with-listings set (substitutes search the whole catalog,
 * not the filtered view, so a usable swap isn't hidden by the active filters). */
export function buildCatalogView(allMotors: readonly Motor[], p: CatalogParams): CatalogView {
  const motors = filterCatalog(allMotors, p)
    .map((m) =>
      p.inStock ? { ...m, listings: m.listings.filter((l) => listingInStock(l.status)) } : m,
    )
    .map((m) => groupByDelay(m, p.listingSort));

  const substitutes: Record<number, Substitute[]> = {};
  for (const m of motors) {
    if (motorInStock(m)) continue;
    const subs = findSubstitutes(m, allMotors).slice(0, 4).map(toSubstitute);
    if (subs.length > 0) substitutes[m.id] = subs;
  }
  return { motors, substitutes };
}
