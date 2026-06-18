"use client";

// Per-tab persistence of the catalog's filter query and scroll offset, so that
// returning from a motor detail page (Back, or the header's "home" link) lands
// you on the same filtered view, scrolled to where you were.
//
// We use sessionStorage (not localStorage): it's scoped to this browsing tab, so
// it survives a Back navigation or reload but never bleeds a stale view into a
// brand-new tab. The filter ALSO lives in the URL (for shareable links); this is
// the fallback for the App Router quirk where a manual history.pushState shares
// Next's history-state key, so on Back Next restores the original unfiltered "/"
// and drops the query string entirely. With the query gone from the URL, this
// remembered value is what brings the filter back.

const FILTER_KEY = "hpr.catalog.filter";
const SCROLL_KEY = "hpr.catalog.scroll";

/** Parse a persisted scroll offset, tolerating absent or corrupt data by
 * returning 0 (top) rather than throwing. Pure — unit-tested in a node env. */
export function parseScroll(raw: string | null): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // sessionStorage can throw (disabled, private mode, quota). Degrade to "no
    // saved state" rather than breaking navigation.
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* ignore — see read() */
  }
}

/** The last catalog filter query string for this tab (no leading "?"), or "". */
export function loadFilter(): string {
  return read(FILTER_KEY) ?? "";
}

export function saveFilter(query: string): void {
  write(FILTER_KEY, query);
}

/** The last catalog scroll offset for this tab, in pixels (0 if none). */
export function loadScroll(): number {
  return parseScroll(read(SCROLL_KEY));
}

export function saveScroll(y: number): void {
  write(SCROLL_KEY, String(Math.round(y)));
}
