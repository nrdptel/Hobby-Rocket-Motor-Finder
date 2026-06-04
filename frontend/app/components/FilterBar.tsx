"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useWatchlist } from "@/lib/watchlist";

type Props = {
  manufacturers: string[];
  classes: string[];
  diameters: number[];
  propellants: string[];
};

function parseList(value: string | null): Set<string> {
  if (!value) return new Set();
  return new Set(value.split(",").filter(Boolean));
}

function toggleInList(list: Set<string>, value: string): string | null {
  const next = new Set(list);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  if (next.size === 0) return null;
  return Array.from(next).join(",");
}

export function FilterBar({
  manufacturers,
  classes,
  diameters,
  propellants,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const { count: starredCount, hydrated } = useWatchlist();

  const activeManufacturers = parseList(sp.get("mfr"));
  const activeClasses = parseList(sp.get("class"));
  const activeDiameters = parseList(sp.get("dia"));
  const activePropellants = parseList(sp.get("prop"));
  const inStockOnly = sp.get("in_stock") === "1";
  const cheapestFirst = sp.get("sort") === "price";
  const starredOnly = sp.get("starred") === "1";
  const urlQuery = sp.get("q") ?? "";
  const urlMinImpulse = sp.get("imin") ?? "";
  const urlMaxImpulse = sp.get("imax") ?? "";

  // Local state for the free-text inputs so typing feels instant. Debounce
  // pushes to the URL (which triggers a server re-render).
  const [query, setQuery] = useState(urlQuery);
  const [minImpulse, setMinImpulse] = useState(urlMinImpulse);
  const [maxImpulse, setMaxImpulse] = useState(urlMaxImpulse);

  // Keep local in sync when URL changes externally (e.g., Clear all).
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);
  useEffect(() => {
    setMinImpulse(urlMinImpulse);
  }, [urlMinImpulse]);
  useEffect(() => {
    setMaxImpulse(urlMaxImpulse);
  }, [urlMaxImpulse]);

  const update = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(sp.toString());
      if (value == null) next.delete(key);
      else next.set(key, value);
      const qs = next.toString();
      router.push(qs ? `/?${qs}` : "/", { scroll: false });
    },
    [router, sp],
  );

  // Debounced push: 250ms after the user stops typing.
  useEffect(() => {
    if (query === urlQuery) return;
    const id = setTimeout(() => {
      update("q", query.trim() ? query.trim() : null);
    }, 250);
    return () => clearTimeout(id);
  }, [query, urlQuery, update]);

  // Same debounce for the impulse range inputs. A blank or non-numeric value
  // clears the bound rather than pushing garbage to the URL.
  useEffect(() => {
    if (minImpulse === urlMinImpulse) return;
    const id = setTimeout(() => {
      const n = minImpulse.trim();
      update("imin", n && Number.isFinite(Number(n)) ? n : null);
    }, 250);
    return () => clearTimeout(id);
  }, [minImpulse, urlMinImpulse, update]);
  useEffect(() => {
    if (maxImpulse === urlMaxImpulse) return;
    const id = setTimeout(() => {
      const n = maxImpulse.trim();
      update("imax", n && Number.isFinite(Number(n)) ? n : null);
    }, 250);
    return () => clearTimeout(id);
  }, [maxImpulse, urlMaxImpulse, update]);

  const toggleMfr = (m: string) => update("mfr", toggleInList(activeManufacturers, m));
  const toggleClass = (c: string) => update("class", toggleInList(activeClasses, c));
  const toggleDia = (d: number) =>
    update("dia", toggleInList(activeDiameters, String(d)));
  const toggleProp = (p: string) =>
    update("prop", toggleInList(activePropellants, p));
  const toggleStock = () => update("in_stock", inStockOnly ? null : "1");
  const toggleSort = () => update("sort", cheapestFirst ? null : "price");
  const toggleStarred = () => update("starred", starredOnly ? null : "1");

  const anyFilter =
    activeManufacturers.size > 0 ||
    activeClasses.size > 0 ||
    activeDiameters.size > 0 ||
    activePropellants.size > 0 ||
    inStockOnly ||
    cheapestFirst ||
    starredOnly ||
    urlQuery.length > 0 ||
    urlMinImpulse.length > 0 ||
    urlMaxImpulse.length > 0;
  const clearAll = () => router.push("/", { scroll: false });

  const pill = (active: boolean) =>
    `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition cursor-pointer ${
      active
        ? "bg-zinc-100 text-zinc-900 border-zinc-100"
        : "bg-zinc-900 text-zinc-300 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
    }`;

  return (
    <div className="mt-4 space-y-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-wider text-zinc-400">
          Filters
        </div>
        {anyFilter && (
          <button
            onClick={clearAll}
            className="text-xs text-zinc-200 underline underline-offset-2 hover:text-white"
          >
            clear all
          </button>
        )}
      </div>

      <FilterRow label="Search">
        <div className="relative flex-1 min-w-[14rem] max-w-md">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="motor designation or vendor SKU — e.g. H242 or J350"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
            aria-label="Search motor designation or vendor SKU"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </FilterRow>

      {manufacturers.length > 1 && (
        <FilterRow label="Brand">
          {manufacturers.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => toggleMfr(m)}
              className={pill(activeManufacturers.has(m))}
            >
              {m}
            </button>
          ))}
        </FilterRow>
      )}

      <FilterRow label="Class">
        {classes.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => toggleClass(c)}
            className={pill(activeClasses.has(c))}
          >
            {c}
          </button>
        ))}
      </FilterRow>

      <FilterRow label="Diameter">
        {diameters.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => toggleDia(d)}
            className={pill(activeDiameters.has(String(d)))}
          >
            {d}mm
          </button>
        ))}
      </FilterRow>

      <FilterRow label="Propellant">
        {propellants.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => toggleProp(p)}
            className={pill(activePropellants.has(p))}
          >
            {p}
          </button>
        ))}
      </FilterRow>

      <FilterRow label="Impulse">
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={minImpulse}
            onChange={(e) => setMinImpulse(e.target.value)}
            placeholder="min"
            className="w-20 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
            aria-label="Minimum total impulse in newton-seconds"
          />
          <span>–</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={maxImpulse}
            onChange={(e) => setMaxImpulse(e.target.value)}
            placeholder="max"
            className="w-20 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
            aria-label="Maximum total impulse in newton-seconds"
          />
          <span className="text-zinc-500">N·s</span>
        </div>
      </FilterRow>

      <FilterRow label="Stock">
        <button
          type="button"
          onClick={toggleStock}
          className={pill(inStockOnly)}
        >
          In stock only
        </button>
        <button
          type="button"
          onClick={toggleSort}
          className={pill(cheapestFirst)}
          title="Within each motor, list the cheapest vendor first instead of alphabetically"
        >
          Cheapest first
        </button>
        <button
          type="button"
          onClick={toggleStarred}
          className={pill(starredOnly)}
          title="Show only motors you've starred (saved in this browser)"
        >
          ★ Starred{hydrated && starredCount > 0 ? ` (${starredCount})` : ""}
        </button>
      </FilterRow>
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-20 shrink-0 text-xs font-medium uppercase tracking-wider text-zinc-400">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5 flex-1">{children}</div>
    </div>
  );
}
