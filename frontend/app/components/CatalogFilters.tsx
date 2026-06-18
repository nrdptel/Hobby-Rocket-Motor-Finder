"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { loadFilter, saveFilter } from "@/lib/catalogSession";

// Client-side filter state for the catalog. This replaces reading filters from
// the router/useSearchParams: the filter URL lives in React state (seeded from
// the server-rendered URL), so changing a filter re-renders the in-memory
// catalog INSTANTLY with no navigation / server round-trip. The browser URL is
// kept in sync via the History API (replaceState — no Next navigation), so links
// stay shareable and back/forward still work. The full catalog ships once; all
// filtering happens here.

type FilterContext = {
  /** Current filter state as URLSearchParams (read by FilterBar / MyRockets /
   *  CatalogView via parseCatalogParams). */
  params: URLSearchParams;
  /** Set or (value == null) delete a single key. */
  update: (key: string, value: string | null) => void;
  /** Replace the whole filter set (MyRockets applies several params at once). */
  replace: (next: URLSearchParams) => void;
  /** Clear every filter. */
  clearAll: () => void;
};

const Ctx = createContext<FilterContext | null>(null);

function writeUrl(params: URLSearchParams, mode: "push" | "replace" = "push") {
  if (typeof window === "undefined") return;
  const qs = params.toString();
  const url = qs ? `/?${qs}` : "/";
  // pushState (not replaceState) so Back undoes a filter — preserving the old
  // router.push behavior — but WITHOUT a Next navigation / server fetch, so the
  // change is instant. No-op the push when the URL is unchanged (e.g. a re-set to
  // the same value) to avoid stacking duplicate history entries. `mode: "replace"`
  // is used when *restoring* a remembered filter (see adopt): we re-affirm the
  // URL without adding a history entry, so Back still leaves the catalog.
  if (mode === "push" && window.location.pathname + window.location.search === url) {
    return;
  }
  const apply = mode === "replace" ? window.history.replaceState : window.history.pushState;
  apply.call(window.history, window.history.state, "", url);
}

export function CatalogFilterProvider({
  initialQuery = "",
  children,
}: {
  initialQuery?: string;
  children: ReactNode;
}) {
  // Starts empty so the first client render matches the static SSR HTML (which is
  // unfiltered) — no hydration mismatch. The mount effect below then reads the
  // actual URL and applies any shared filter; for the bare homepage that's a
  // no-op, and a shared filtered link (e.g. /?in_stock=1) snaps to its filtered
  // view one frame after hydration.
  const [search, setSearch] = useState(initialQuery);
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const apply = useCallback((next: URLSearchParams) => {
    const qs = next.toString();
    writeUrl(next);
    // Remember the filter for this tab so a Back navigation from a motor page
    // restores it even if Next drops the query from the URL (see adopt).
    saveFilter(qs);
    setSearch(qs);
  }, []);

  const update = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params);
      if (value == null) next.delete(key);
      else next.set(key, value);
      apply(next);
    },
    [params, apply],
  );

  const replace = useCallback((next: URLSearchParams) => apply(next), [apply]);
  const clearAll = useCallback(() => apply(new URLSearchParams()), [apply]);

  // Adopt the active filter for this view: prefer the URL's query (a shared
  // filtered link, or a filter the user just set), and otherwise fall back to
  // this tab's remembered filter. The fallback is what fixes returning from a
  // motor page: the App Router restores the unfiltered "/" on Back and drops the
  // query, so without the remembered value the filter would be lost. When we
  // restore from memory we also re-affirm it in the URL (replace, no new history
  // entry) so the link stays shareable and consistent.
  const adopt = useCallback(() => {
    const fromUrl = window.location.search.replace(/^\?/, "");
    if (fromUrl) {
      saveFilter(fromUrl);
      setSearch(fromUrl);
      return;
    }
    const saved = loadFilter();
    if (saved) {
      writeUrl(new URLSearchParams(saved), "replace");
      setSearch(saved);
    } else {
      setSearch("");
    }
  }, []);

  // On mount (incl. a Back navigation that remounts this provider), adopt the
  // filter. The static page seeds us empty, so this is what applies a shared
  // filtered link or a remembered filter after hydration. Runs once.
  useEffect(() => {
    adopt();
  }, [adopt]);

  // Back/forward within the catalog: re-adopt from the URL the browser restored.
  useEffect(() => {
    window.addEventListener("popstate", adopt);
    return () => window.removeEventListener("popstate", adopt);
  }, [adopt]);

  const value = useMemo(
    () => ({ params, update, replace, clearAll }),
    [params, update, replace, clearAll],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCatalogFilters(): FilterContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCatalogFilters must be used within <CatalogFilterProvider>");
  return ctx;
}
