// Pure "does this motor fit this rocket" logic — no React, no DOM, no client
// store. Lives apart from rockets.ts (which is "use client") so the alert
// dispatch route can import it server-side without pulling the browser store
// into the server bundle. rockets.ts re-exports these for client consumers.

import { certClasses } from "./derive";

/** The fit-relevant fields of a saved rocket. */
export type RocketSpec = {
  diameterMm: number;
  cert: string; // a CERT_LEVELS key ("mid" | "l1" | "l2" | "l3")
  minImpulseNs: number | null;
  maxImpulseNs: number | null;
};

/** The fit-relevant fields of a motor. */
export type FitMotor = {
  diameter_mm: number;
  impulse_class: string;
  total_impulse_ns: number | null;
};

/** True when a motor fits a rocket: same mount diameter, an impulse class the
 * rocket's cert covers, and (if the rocket sets a band) within its impulse
 * window. Stock is checked separately by the caller. */
export function motorFitsRocket(r: RocketSpec, m: FitMotor): boolean {
  if (m.diameter_mm !== r.diameterMm) return false;
  if (!certClasses(new Set([r.cert])).has(m.impulse_class)) return false;
  if (r.minImpulseNs != null && (m.total_impulse_ns == null || m.total_impulse_ns < r.minImpulseNs))
    return false;
  if (r.maxImpulseNs != null && (m.total_impulse_ns == null || m.total_impulse_ns > r.maxImpulseNs))
    return false;
  return true;
}
