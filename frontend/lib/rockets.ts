"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { certClasses } from "./derive";

// Browser-persisted "my rockets": each is a saved {motor-mount diameter + cert
// level} the flyer owns, so one click filters the catalog to the motors that
// physically fit AND they're rated to fly. Lives entirely client-side (like the
// watchlist) and is shared via a module-level external store so every consumer
// updates without a context Provider.

const STORAGE_KEY = "hpr.rockets.v1";

export type Rocket = {
  id: string;
  name: string; // optional label; "" means show the spec instead
  diameterMm: number;
  cert: string; // a CERT_LEVELS key ("mid" | "l1" | "l2" | "l3")
  // Optional preferred total-impulse window (N·s). null = open bound. Applying a
  // rocket sets the imin/imax filters to these; absent on rockets saved before
  // this field existed.
  minImpulseNs: number | null;
  maxImpulseNs: number | null;
};

function numOrNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/** Minimal motor shape the rocket match-count needs (a compact summary the page
 * passes down, rather than the full Motor objects). */
export type RocketMotor = {
  diameter_mm: number;
  impulse_class: string;
  total_impulse_ns: number | null;
  inStock: boolean;
};

/** True when a motor fits a rocket: same mount diameter, an impulse class the
 * rocket's cert covers, and (if the rocket sets a band) within its impulse
 * window. Stock is checked separately by the caller. */
export function motorFitsRocket(
  r: Pick<Rocket, "diameterMm" | "cert" | "minImpulseNs" | "maxImpulseNs">,
  m: Pick<RocketMotor, "diameter_mm" | "impulse_class" | "total_impulse_ns">,
): boolean {
  if (m.diameter_mm !== r.diameterMm) return false;
  if (!certClasses(new Set([r.cert])).has(m.impulse_class)) return false;
  if (r.minImpulseNs != null && (m.total_impulse_ns == null || m.total_impulse_ns < r.minImpulseNs))
    return false;
  if (r.maxImpulseNs != null && (m.total_impulse_ns == null || m.total_impulse_ns > r.maxImpulseNs))
    return false;
  return true;
}

/** Count the in-stock motors that fit a rocket — powers the per-rocket "(N)"
 * availability badge. */
export function rocketInStockCount(
  r: Pick<Rocket, "diameterMm" | "cert" | "minImpulseNs" | "maxImpulseNs">,
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
      if (typeof r.cert !== "string") return [];
      const id = typeof r.id === "string" && r.id ? r.id : String(r.diameterMm) + r.cert;
      const name = typeof r.name === "string" ? r.name : "";
      return [
        {
          id,
          name,
          diameterMm: r.diameterMm,
          cert: r.cert,
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

/** Add a rocket and persist; returns the created rocket. */
export function addRocket(spec: {
  name?: string;
  diameterMm: number;
  cert: string;
  minImpulseNs?: number | null;
  maxImpulseNs?: number | null;
}): Rocket {
  load();
  const rocket: Rocket = {
    id: newId(),
    name: (spec.name ?? "").trim(),
    diameterMm: spec.diameterMm,
    cert: spec.cert,
    minImpulseNs: spec.minImpulseNs ?? null,
    maxImpulseNs: spec.maxImpulseNs ?? null,
  };
  current = [...current, rocket];
  persist();
  emit();
  return rocket;
}

/** Remove a rocket by id and persist. */
export function removeRocket(id: string): void {
  load();
  current = current.filter((r) => r.id !== id);
  persist();
  emit();
}

export type Rockets = {
  rockets: readonly Rocket[];
  add: (spec: {
    name?: string;
    diameterMm: number;
    cert: string;
    minImpulseNs?: number | null;
    maxImpulseNs?: number | null;
  }) => Rocket;
  remove: (id: string) => void;
  /** False during SSR and first client paint; true after mount. Gate
   * rocket-dependent UI on this so the first render matches the server. */
  hydrated: boolean;
};

export function useRockets(): Rockets {
  const rockets = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return { rockets, add: addRocket, remove: removeRocket, hydrated };
}
