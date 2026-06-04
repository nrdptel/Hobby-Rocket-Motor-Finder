"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Browser-persisted set of starred motor ids. Lives entirely client-side — the
// server never sees it — so the "starred only" view is applied after hydration.
// Shared across every StarButton / FilterBar / MotorResults via a module-level
// external store (useSyncExternalStore), so toggling one star updates them all
// without a context Provider.

const STORAGE_KEY = "hpr.watchlist";

// --- pure helpers (no window/localStorage; unit-tested in a node env) --------

/** Parse the persisted payload into motor ids, tolerating absent or corrupt
 * data by returning ``[]`` rather than throwing. */
export function parseWatchlist(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  } catch {
    return [];
  }
}

/** Serialize ids to the persisted form, sorted for stable, diff-friendly output. */
export function serializeWatchlist(ids: Iterable<number>): string {
  return JSON.stringify([...ids].sort((a, b) => a - b));
}

/** Return a new Set with ``id`` toggled — added if absent, removed if present. */
export function toggleId(ids: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// --- client-only external store ----------------------------------------------

const EMPTY: ReadonlySet<number> = new Set();
let current: ReadonlySet<number> = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded || typeof window === "undefined") return;
  current = new Set(parseWatchlist(window.localStorage.getItem(STORAGE_KEY)));
  loaded = true;
}

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Keep tabs in sync: another tab starring a motor writes localStorage, which
  // fires a 'storage' event here.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      current = new Set(parseWatchlist(e.newValue));
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

// getSnapshot must return a stable reference between renders unless the data
// actually changed, or useSyncExternalStore loops — so we mutate `current` only
// on a real toggle / storage event, never per call.
function getSnapshot(): ReadonlySet<number> {
  load();
  return current;
}

function getServerSnapshot(): ReadonlySet<number> {
  return EMPTY;
}

/** Toggle a motor's starred state and persist. Callable from any component;
 * every ``useWatchlist`` consumer re-renders. */
export function toggleStar(id: number): void {
  load();
  current = toggleId(current, id);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, serializeWatchlist(current));
  }
  emit();
}

export type Watchlist = {
  starred: ReadonlySet<number>;
  isStarred: (id: number) => boolean;
  toggle: (id: number) => void;
  /** False during SSR and the first client paint; true after mount. Gate any
   * starred-dependent UI on this so the first render matches the server. */
  hydrated: boolean;
  count: number;
};

export function useWatchlist(): Watchlist {
  const starred = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return {
    starred,
    isStarred: (id) => starred.has(id),
    toggle: toggleStar,
    hydrated,
    count: starred.size,
  };
}
