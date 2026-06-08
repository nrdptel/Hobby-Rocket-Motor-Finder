"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { motorFitsRocket, type FitMotor, type RocketSpec } from "./rocketFit";

// Re-export the pure fit logic so existing client consumers keep importing it
// from "@/lib/rockets"; the implementation lives in rocketFit.ts (server-safe).
export { motorFitsRocket, type RocketSpec } from "./rocketFit";

// Browser-persisted "my rockets": each is a saved motor-mount the flyer owns.
// The mount diameter is the only required field; cert, a specific impulse class,
// a reload case, and an impulse band are all optional narrowings. One click
// filters the catalog to the motors that fit. Lives entirely client-side (like
// the watchlist) and is shared via a module-level external store so every
// consumer updates without a context Provider.

const STORAGE_KEY = "hpr.rockets.v1";

export type Rocket = {
  id: string;
  name: string; // optional label; "" means show the spec instead
  diameterMm: number; // the only required field
  // cert was required on rockets saved before it became optional; those simply
  // keep their cert. impulseClasses + caseInfos are multi-value: a rocket can
  // pin several classes and/or several reload cases (e.g. all the cases it can
  // fly). An empty list = unconstrained.
  cert: string | null; // a CERT_LEVELS key ("mid" | "l1" | "l2" | "l3")
  impulseClasses: string[]; // class letters, e.g. ["H", "I"]
  caseInfos: string[]; // case values, e.g. ["RMS-38/720", "RMS-38/360"]
  // Optional preferred total-impulse window (N·s). null = open bound.
  minImpulseNs: number | null;
  maxImpulseNs: number | null;
};

/** The mutable fields of a rocket, as accepted by add/update. */
export type RocketInput = {
  name?: string;
  diameterMm: number;
  cert?: string | null;
  impulseClasses?: string[];
  caseInfos?: string[];
  minImpulseNs?: number | null;
  maxImpulseNs?: number | null;
};

function strOrNull(x: unknown): string | null {
  return typeof x === "string" && x ? x : null;
}

function numOrNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/** Coerce a persisted multi-value field into a clean string list, tolerating the
 * legacy single-string form (a rocket saved before the field went multi-value)
 * by lifting it into a one-element list. Drops non-string / empty entries and
 * de-dupes, preserving order. */
function strArr(...candidates: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };
  for (const x of candidates) {
    if (Array.isArray(x)) {
      for (const v of x) if (typeof v === "string") push(v);
    } else if (typeof x === "string") {
      push(x);
    }
  }
  return out;
}

/** Minimal motor shape the rocket match-count needs (a compact summary the page
 * passes down, rather than the full Motor objects). */
export type RocketMotor = FitMotor & { inStock: boolean };

// The catalog URL params a rocket maps onto when applied as a filter.
export const ROCKET_PARAMS = ["dia", "cert", "class", "case", "imin", "imax"] as const;

/** True when the current catalog filter params exactly describe this rocket —
 * i.e. it's the "active" rocket. `get` reads a param (null/undefined = absent).
 * Pure (no React/URL types) so the chip row and the loadout agree on which
 * rocket, if any, is in focus. */
export function rocketMatchesParams(
  r: Pick<Rocket, "diameterMm" | "cert" | "impulseClasses" | "caseInfos" | "minImpulseNs" | "maxImpulseNs">,
  get: (key: string) => string | null | undefined,
): boolean {
  const strEq = (p: string, v: string | null) => (v == null ? !get(p) : get(p) === v);
  const numEq = (p: string, v: number | null) => (v == null ? !get(p) : get(p) === String(v));
  // A multi-value param (comma list) equals the rocket's list as a SET — order-
  // and duplicate-insensitive — so a rocket whose cases the URL lists in any
  // order still reads as the active one. An empty list ⇒ the param is absent.
  const setEq = (p: string, vals: string[]) => {
    const raw = get(p);
    if (vals.length === 0) return !raw;
    if (!raw) return false;
    const got = new Set(raw.split(",").filter(Boolean));
    return got.size === vals.length && vals.every((v) => got.has(v));
  };
  return (
    get("dia") === String(r.diameterMm) &&
    strEq("cert", r.cert) &&
    setEq("class", r.impulseClasses) &&
    setEq("case", r.caseInfos) &&
    numEq("imin", r.minImpulseNs) &&
    numEq("imax", r.maxImpulseNs)
  );
}

/** Count the in-stock motors that fit a rocket — powers the per-rocket "(N)"
 * availability badge. */
export function rocketInStockCount(
  r: RocketSpec,
  motors: readonly RocketMotor[],
): number {
  let n = 0;
  for (const m of motors) if (m.inStock && motorFitsRocket(r, m)) n++;
  return n;
}

// --- pure helpers (no window/localStorage; unit-tested in a node env) --------

/** Parse the persisted payload into rockets, tolerating absent/corrupt data by
 * returning ``[]`` and dropping any malformed entry rather than throwing. */
export function parseRockets(raw: string | null): Rocket[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.flatMap((x): Rocket[] => {
      if (typeof x !== "object" || x === null) return [];
      const r = x as Record<string, unknown>;
      if (typeof r.diameterMm !== "number" || !Number.isFinite(r.diameterMm)) return [];
      const cert = strOrNull(r.cert);
      const id = typeof r.id === "string" && r.id ? r.id : `${r.diameterMm}-${cert ?? ""}`;
      const name = typeof r.name === "string" ? r.name : "";
      return [
        {
          id,
          name,
          diameterMm: r.diameterMm,
          cert,
          // Read the multi-value form, falling back to the legacy single-string
          // keys (impulseClass / caseInfo) for rockets saved before they went
          // multi-value.
          impulseClasses: strArr(r.impulseClasses, r.impulseClass),
          caseInfos: strArr(r.caseInfos, r.caseInfo),
          minImpulseNs: numOrNull(r.minImpulseNs),
          maxImpulseNs: numOrNull(r.maxImpulseNs),
        },
      ];
    });
  } catch {
    return [];
  }
}

/** Serialize rockets to the persisted form. */
export function serializeRockets(rockets: readonly Rocket[]): string {
  return JSON.stringify(rockets);
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `r-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

// --- client-only external store ----------------------------------------------

const EMPTY: readonly Rocket[] = [];
let current: readonly Rocket[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded || typeof window === "undefined") return;
  current = parseRockets(window.localStorage.getItem(STORAGE_KEY));
  loaded = true;
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeRockets(current));
  } catch {
    /* storage disabled/full — keep the in-memory list, skip persistence */
  }
}

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      current = parseRockets(e.newValue);
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): readonly Rocket[] {
  load();
  return current;
}

function getServerSnapshot(): readonly Rocket[] {
  return EMPTY;
}

function fromInput(spec: RocketInput): Omit<Rocket, "id"> {
  return {
    name: (spec.name ?? "").trim(),
    diameterMm: spec.diameterMm,
    cert: spec.cert ?? null,
    impulseClasses: strArr(spec.impulseClasses),
    caseInfos: strArr(spec.caseInfos),
    minImpulseNs: spec.minImpulseNs ?? null,
    maxImpulseNs: spec.maxImpulseNs ?? null,
  };
}

/** Add a rocket and persist; returns the created rocket. */
export function addRocket(spec: RocketInput): Rocket {
  load();
  const rocket: Rocket = { id: newId(), ...fromInput(spec) };
  current = [...current, rocket];
  persist();
  emit();
  return rocket;
}

/** Update an existing rocket in place (preserving id + position) and persist. */
export function updateRocket(id: string, spec: RocketInput): void {
  load();
  current = current.map((r) => (r.id === id ? { ...r, ...fromInput(spec) } : r));
  persist();
  emit();
}

/** Remove a rocket by id and persist. */
export function removeRocket(id: string): void {
  load();
  current = current.filter((r) => r.id !== id);
  persist();
  emit();
}

/** Re-insert a previously-removed rocket at ``index`` (preserving its id and,
 * where possible, its original position) and persist. No-op if its id is already
 * present. Powers undo-on-delete. */
export function restoreRocket(rocket: Rocket, index: number): void {
  load();
  if (current.some((r) => r.id === rocket.id)) return;
  const next = [...current];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, rocket);
  current = next;
  persist();
  emit();
}

export type Rockets = {
  rockets: readonly Rocket[];
  add: (spec: RocketInput) => Rocket;
  update: typeof updateRocket;
  remove: (id: string) => void;
  restore: typeof restoreRocket;
  /** False during SSR and first client paint; true after mount. Gate
   * rocket-dependent UI on this so the first render matches the server. */
  hydrated: boolean;
};

export function useRockets(): Rockets {
  const rockets = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return {
    rockets,
    add: addRocket,
    update: updateRocket,
    remove: removeRocket,
    restore: restoreRocket,
    hydrated,
  };
}
