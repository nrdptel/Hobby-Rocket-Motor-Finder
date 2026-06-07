// Pure "does this motor fit this rocket" logic — no React, no DOM, no client
// store. Lives apart from rockets.ts (which is "use client") so the alert
// dispatch route can import it server-side without pulling the browser store
// into the server bundle. rockets.ts re-exports these for client consumers.

import { caseKey, certClasses } from "./derive";

/** The fit-relevant fields of a saved rocket. The motor-mount diameter is the
 * only required dimension; every other field is an optional narrowing — a rocket
 * may pin a cert level, a specific impulse class, a reload case, and/or an
 * impulse band, or none of them. */
export type RocketSpec = {
  diameterMm: number;
  cert: string | null; // a CERT_LEVELS key ("mid" | "l1" | "l2" | "l3"), or null
  impulseClass: string | null; // a single class letter ("H"), or null
  caseInfo: string | null; // a case value (e.g. "RMS-38/720", "Single use"), or null
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
 * covers), a specific impulse class, a reload case (via caseKey, so "Single use"
 * works too), and the impulse band. Stock is checked separately by the caller. */
export function motorFitsRocket(r: RocketSpec, m: FitMotor): boolean {
  if (m.diameter_mm !== r.diameterMm) return false;
  if (r.cert != null && !certClasses(new Set([r.cert])).has(m.impulse_class)) return false;
  if (r.impulseClass != null && m.impulse_class !== r.impulseClass) return false;
  if (r.caseInfo != null && caseKey(m) !== r.caseInfo) return false;
  if (r.minImpulseNs != null && (m.total_impulse_ns == null || m.total_impulse_ns < r.minImpulseNs))
    return false;
  if (r.maxImpulseNs != null && (m.total_impulse_ns == null || m.total_impulse_ns > r.maxImpulseNs))
    return false;
  return true;
}
