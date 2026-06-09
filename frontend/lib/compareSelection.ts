"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Browser-persisted set of motor ids picked for side-by-side comparison. Like
// the watchlist, it lives entirely client-side via a module-level external store
// (useSyncExternalStore), so a CompareButton, the CompareTray, and any other
// consumer stay in sync without a context Provider. Capped at MAX_COMPARE so the
// overlay chart + table stay legible (and the share URL stays short).

const STORAGE_KEY = "hpr.compare";

/** Most motors you can compare at once — the overlay chart uses a 4-color cycle,
 * so beyond this the curves stop being distinguishable. */
export const MAX_COMPARE = 4;

// --- pure helpers (no window/localStorage; unit-tested in a node env) --------

/** Parse the persisted payload into motor ids, tolerating absent or corrupt
 * data by returning ``[]`` rather than throwing. Caps to MAX_COMPARE so a
 * hand-edited/older payload can't blow past the limit. */
export function parseCompare(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      .slice(0, MAX_COMPARE);
  } catch {
    return [];
  }
}

/** Serialize ids to the persisted form, sorted for stable, diff-friendly output. */
export function serializeCompare(ids: Iterable<number>): string {
  return JSON.stringify([...ids].sort((a, b) => a - b));
}

/** Toggle ``id`` in the selection: remove if present; add if absent and there's
 * room; otherwise (already at ``max``) return the set unchanged so the caller can
 * surface "you can compare up to N at once". */
export function toggleCompareId(
  ids: ReadonlySet<number>,
  id: number,
  max = MAX_COMPARE,
): Set<number> {
  const next = new Set(ids);
  if (next.has(id)) {
    next.delete(id);
  } else if (next.size < max) {
    next.add(id);
  }
  return next;
}

// --- client-only external store ----------------------------------------------

const EMPTY: ReadonlySet<number> = new Set();
let current: ReadonlySet<number> = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded || typeof window === "undefined") return;
  current = new Set(parseCompare(window.localStorage.getItem(STORAGE_KEY)));
  loaded = true;
}

function emit(): void {
  for (const l of listeners) l();
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    if (current.size === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, serializeCompare(current));
  } catch {
    /* ignore — Safari private mode / storage disabled or full */
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Keep tabs in sync: another tab changing the selection writes localStorage,
  // which fires a 'storage' event here.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      current = new Set(parseCompare(e.newValue));
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

// getSnapshot must return a stable reference unless the data actually changed,
// or useSyncExternalStore loops — so we mutate `current` only on a real change.
function getSnapshot(): ReadonlySet<number> {
  load();
  return current;
}

function getServerSnapshot(): ReadonlySet<number> {
  return EMPTY;
}

/** Toggle a motor in/out of the comparison set and persist. A no-op add when the
 * set is already full (MAX_COMPARE). */
export function toggleCompare(id: number): void {
  load();
  const next = toggleCompareId(current, id);
  if (next.size === current.size && [...next].every((x) => current.has(x))) return; // unchanged
  current = next;
  persist();
  emit();
}

/** Empty the comparison set entirely and persist. */
export function clearCompare(): void {
  loaded = true;
  current = EMPTY;
  persist();
  emit();
}

export type CompareSelection = {
  selected: ReadonlySet<number>;
  isSelected: (id: number) => boolean;
  /** True when adding this id is allowed — already selected, or there's room. */
  canAdd: (id: number) => boolean;
  toggle: (id: number) => void;
  clear: () => void;
  /** False during SSR and the first client paint; true after mount. Gate any
   * selection-dependent UI on this so the first render matches the server. */
  hydrated: boolean;
  count: number;
  atCapacity: boolean;
};

export function useCompare(): CompareSelection {
  const selected = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return {
    selected,
    isSelected: (id) => selected.has(id),
    canAdd: (id) => selected.has(id) || selected.size < MAX_COMPARE,
    toggle: toggleCompare,
    clear: clearCompare,
    hydrated,
    count: selected.size,
    atCapacity: selected.size >= MAX_COMPARE,
  };
}
