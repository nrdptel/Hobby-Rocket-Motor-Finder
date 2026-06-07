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

function writeUrl(params: URLSearchParams) {
  if (typeof window === "undefined") return;
  const qs = params.toString();
  const url = qs ? `/?${qs}` : "/";
  // pushState (not replaceState) so Back undoes a filter — preserving the old
  // router.push behavior — but WITHOUT a Next navigation / server fetch, so the
  // change is instant. No-op the push when the URL is unchanged (e.g. a re-set to
  // the same value) to avoid stacking duplicate history entries.
  if (window.location.pathname + window.location.search !== url) {
    window.history.pushState(window.history.state, "", url);
  }
}

export function CatalogFilterProvider({
  initialQuery,
  children,
}: {
  initialQuery: string;
  children: ReactNode;
}) {
  // Seeded from the server-rendered URL so SSR and the first client render match
  // exactly (the server already rendered this filtered view) — no flash, no
  // hydration mismatch.
  const [search, setSearch] = useState(initialQuery);
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const apply = useCallback((next: URLSearchParams) => {
    writeUrl(next);
    setSearch(next.toString());
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

  // Back/forward: re-read the URL the browser restored into our state.
  useEffect(() => {
    const onPop = () => setSearch(window.location.search.replace(/^\?/, ""));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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
