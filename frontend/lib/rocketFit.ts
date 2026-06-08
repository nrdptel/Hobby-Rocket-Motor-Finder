// Pure "does this motor fit this rocket" logic — no React, no DOM, no client
// store. Lives apart from rockets.ts (which is "use client") so the alert
// dispatch route can import it server-side without pulling the browser store
// into the server bundle. rockets.ts re-exports these for client consumers.

import { caseKey, certClasses } from "./derive";

/** The fit-relevant fields of a saved rocket. The motor-mount diameter is the
 * only required dimension; every other field is an optional narrowing — a rocket
 * may pin one or more impulse classes, one or more reload cases (e.g. every case
 * it can fly), and/or an impulse band, or none of them. The class and case lists
 * are OR-matched: a motor fits if its class is any of the pinned classes and its
 * case is any of the pinned cases. An empty list means that dimension is
 * unconstrained.
 *
 * `cert` is optional + legacy: the My Rockets UI no longer sets it, but rocket-
 * fit alert subscriptions made before it was removed still carry one, so the fit
 * function keeps honoring it when present. */
export type RocketSpec = {
  diameterMm: number;
  cert?: string | null; // legacy cert key ("mid" | "l1" | "l2" | "l3"); usually unset
  impulseClasses: string[]; // class letters ("H", "I"); empty = any
  caseInfos: string[]; // case values ("RMS-38/720", "Single use"); empty = any
  minImpulseNs: number | null;
  maxImpulseNs: number | null;
};

/** The fit-relevant fields of a motor. */
export type FitMotor = {
  diameter_mm: number;
  impulse_class: string;
  total_impulse_ns: number | null;
  case_info?: string | null;
  motor_type?: string | null;
};

/** True when a motor fits a rocket. The mount diameter must match; each other
 * field constrains only when the rocket sets it — cert (an impulse class it
 * covers), the impulse-class list (any one of them), the reload-case list (any
 * one of them, via caseKey, so "Single use" works too), and the impulse band.
 * A list constrains only when non-empty. Stock is checked separately by the
 * caller. */
export function motorFitsRocket(r: RocketSpec, m: FitMotor): boolean {
  if (m.diameter_mm !== r.diameterMm) return false;
  if (r.cert != null && !certClasses(new Set([r.cert])).has(m.impulse_class)) return false;
  if (r.impulseClasses.length > 0 && !r.impulseClasses.includes(m.impulse_class)) return false;
  if (r.caseInfos.length > 0) {
    const k = caseKey(m);
    if (k == null || !r.caseInfos.includes(k)) return false;
  }
  if (r.minImpulseNs != null && (m.total_impulse_ns == null || m.total_impulse_ns < r.minImpulseNs))
    return false;
  if (r.maxImpulseNs != null && (m.total_impulse_ns == null || m.total_impulse_ns > r.maxImpulseNs))
    return false;
  return true;
}
