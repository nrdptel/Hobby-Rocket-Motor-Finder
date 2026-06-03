"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Props = {
  manufacturers: string[];
  classes: string[];
  diameters: number[];
  propellants: string[];
  // For display only — server computes the actual numbers.
  totalMotors: number;
  visibleMotors: number;
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
  totalMotors,
  visibleMotors,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();

  const activeManufacturers = parseList(sp.get("mfr"));
  const activeClasses = parseList(sp.get("class"));
  const activeDiameters = parseList(sp.get("dia"));
  const activePropellants = parseList(sp.get("prop"));
  const inStockOnly = sp.get("in_stock") === "1";
  const urlQuery = sp.get("q") ?? "";

  // Local state for the search input so typing feels instant. Debounce pushes
  // to the URL (which triggers a server re-render).
  const [query, setQuery] = useState(urlQuery);

  // Keep local in sync when URL changes externally (e.g., Clear all).
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

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

  const toggleMfr = (m: string) => update("mfr", toggleInList(activeManufacturers, m));
  const toggleClass = (c: string) => update("class", toggleInList(activeClasses, c));
  const toggleDia = (d: number) =>
    update("dia", toggleInList(activeDiameters, String(d)));
  const toggleProp = (p: string) =>
    update("prop", toggleInList(activePropellants, p));
  const toggleStock = () => update("in_stock", inStockOnly ? null : "1");

  const anyFilter =
    activeManufacturers.size > 0 ||
    activeClasses.size > 0 ||
    activeDiameters.size > 0 ||
    activePropellants.size > 0 ||
    inStockOnly ||
    urlQuery.length > 0;
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
        <div className="text-xs text-zinc-400">
          {visibleMotors} of {totalMotors} motors shown
          {anyFilter && (
            <>
              {" · "}
              <button
                onClick={clearAll}
                className="text-zinc-200 underline underline-offset-2 hover:text-white"
              >
                clear all
              </button>
            </>
          )}
        </div>
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

      <FilterRow label="Stock">
        <button
          type="button"
          onClick={toggleStock}
          className={pill(inStockOnly)}
        >
          In stock only
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
