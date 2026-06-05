"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { numericParamValue, searchParamValue } from "@/lib/derive";
import { useWatchlist } from "@/lib/watchlist";

type Props = {
  manufacturers: string[];
  classes: string[];
  diameters: number[];
  certLevels: { key: string; label: string; sublabel: string }[];
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

/** Two-way bind a free-text input to a URL query param with debounced writes.
 * Returns ``[value, setValue]`` like useState; mirrors external URL changes
 * (e.g. "clear all", back/forward) into local state, and pushes
 * ``normalize(value)`` to the URL ``delayMs`` after the user stops typing.
 * Collapses the otherwise-identical sync + debounce effect pair we'd repeat
 * per field. ``normalize`` must be a stable reference. */
function useDebouncedParam(
  key: string,
  urlValue: string,
  update: (key: string, value: string | null) => void,
  normalize: (raw: string) => string | null,
  delayMs = 250,
): [string, (v: string) => void] {
  const [value, setValue] = useState(urlValue);
  // Mirror external URL changes into the input.
  useEffect(() => {
    setValue(urlValue);
  }, [urlValue]);
  // Push after the user pauses; the guard avoids echoing back a value we just
  // received from the URL.
  useEffect(() => {
    if (value === urlValue) return;
    const id = setTimeout(() => update(key, normalize(value)), delayMs);
    return () => clearTimeout(id);
  }, [value, urlValue, key, normalize, update, delayMs]);
  return [value, setValue];
}

export function FilterBar({
  manufacturers,
  classes,
  diameters,
  certLevels,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const { count: starredCount, clear: clearWatchlist, hydrated } = useWatchlist();
  const [copied, setCopied] = useState(false);

  const activeManufacturers = parseList(sp.get("mfr"));
  const activeClasses = parseList(sp.get("class"));
  const activeDiameters = parseList(sp.get("dia"));
  const activeCert = parseList(sp.get("cert"));
  const inStockOnly = sp.get("in_stock") === "1";
  const cheapestFirst = sp.get("sort") === "price";
  const sortOrder = sp.get("order") ?? "class";
  const sortDir = sp.get("dir") === "desc" ? "desc" : "asc";
  const starredOnly = sp.get("starred") === "1";
  const urlQuery = sp.get("q") ?? "";
  const urlMinImpulse = sp.get("imin") ?? "";
  const urlMaxImpulse = sp.get("imax") ?? "";

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

  // Free-text inputs: instant local typing, debounced URL writes. The hook also
  // mirrors external URL changes (e.g. "clear all") back into the input.
  const [query, setQuery] = useDebouncedParam("q", urlQuery, update, searchParamValue);
  const [minImpulse, setMinImpulse] = useDebouncedParam(
    "imin",
    urlMinImpulse,
    update,
    numericParamValue,
  );
  const [maxImpulse, setMaxImpulse] = useDebouncedParam(
    "imax",
    urlMaxImpulse,
    update,
    numericParamValue,
  );

  const toggleMfr = (m: string) => update("mfr", toggleInList(activeManufacturers, m));
  const toggleClass = (c: string) => update("class", toggleInList(activeClasses, c));
  const toggleDia = (d: number) =>
    update("dia", toggleInList(activeDiameters, String(d)));
  const toggleCert = (key: string) => update("cert", toggleInList(activeCert, key));
  const toggleStock = () => update("in_stock", inStockOnly ? null : "1");
  const toggleSort = () => update("sort", cheapestFirst ? null : "price");
  const toggleStarred = () => update("starred", starredOnly ? null : "1");

  const anyFilter =
    activeManufacturers.size > 0 ||
    activeClasses.size > 0 ||
    activeDiameters.size > 0 ||
    activeCert.size > 0 ||
    inStockOnly ||
    cheapestFirst ||
    sortOrder !== "class" ||
    sortDir !== "asc" ||
    starredOnly ||
    urlQuery.length > 0 ||
    urlMinImpulse.length > 0 ||
    urlMaxImpulse.length > 0;
  const clearAll = () => router.push("/", { scroll: false });

  // Copy a shareable link to the current filtered view — the filters all live
  // in the URL, so the address itself is the share payload.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (insecure context / denied) — no-op.
    }
  };

  const clearWatch = () => {
    if (
      window.confirm(
        `Remove all ${starredCount} motor${starredCount === 1 ? "" : "s"} from your watchlist?`,
      )
    ) {
      clearWatchlist();
    }
  };

  const pill = (active: boolean) =>
    `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition cursor-pointer ${
      active
        ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
        : "bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    }`;

  return (
    <div className="mt-4 space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Filters
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={copyLink}
            className="text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
            title="Copy a link to this filtered view"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
          {anyFilter && (
            <button
              onClick={clearAll}
              className="text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-200 dark:hover:text-white"
            >
              clear all
            </button>
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
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            aria-label="Search motor designation or vendor SKU"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
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
              aria-pressed={activeManufacturers.has(m)}
              className={pill(activeManufacturers.has(m))}
            >
              {m}
            </button>
          ))}
        </FilterRow>
      )}

      {certLevels.length > 0 && (
        <FilterRow label="Cert">
          {certLevels.map((lvl) => (
            <button
              key={lvl.key}
              type="button"
              onClick={() => toggleCert(lvl.key)}
              aria-pressed={activeCert.has(lvl.key)}
              className={pill(activeCert.has(lvl.key))}
              title={`Motors you can fly at ${lvl.label} (${lvl.sublabel})`}
            >
              {lvl.label}
              <span className="ml-1 opacity-60">{lvl.sublabel}</span>
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
            aria-pressed={activeClasses.has(c)}
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
            aria-pressed={activeDiameters.has(String(d))}
            className={pill(activeDiameters.has(String(d)))}
          >
            {d}mm
          </button>
        ))}
      </FilterRow>

      <FilterRow label="Impulse">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={minImpulse}
            onChange={(e) => setMinImpulse(e.target.value)}
            placeholder="min"
            className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
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
            className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            aria-label="Maximum total impulse in newton-seconds"
          />
          <span className="text-zinc-500">N·s</span>
        </div>
      </FilterRow>

      <FilterRow label="Stock">
        <button
          type="button"
          onClick={toggleStock}
          aria-pressed={inStockOnly}
          className={pill(inStockOnly)}
        >
          In stock only
        </button>
        <button
          type="button"
          onClick={toggleSort}
          aria-pressed={cheapestFirst}
          className={pill(cheapestFirst)}
          title="Within each motor, list the cheapest vendor first instead of alphabetically"
        >
          Cheapest first
        </button>
        <button
          type="button"
          onClick={toggleStarred}
          aria-pressed={starredOnly}
          className={pill(starredOnly)}
          title="Show only motors you've starred (saved in this browser)"
        >
          ★ Starred{hydrated && starredCount > 0 ? ` (${starredCount})` : ""}
        </button>
        {hydrated && starredCount > 0 && (
          <button
            type="button"
            onClick={clearWatch}
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
            title="Remove all motors from your watchlist"
          >
            clear watchlist
          </button>
        )}
      </FilterRow>

      <FilterRow label="Sort by">
        <label htmlFor="sort-order" className="sr-only">
          Sort motors by
        </label>
        <select
          id="sort-order"
          value={sortOrder}
          onChange={(e) => update("order", e.target.value === "class" ? null : e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <option value="class">Class (default)</option>
          <option value="impulse">Total impulse</option>
          <option value="thrust">Avg thrust</option>
          <option value="diameter">Diameter</option>
          <option value="price">Cheapest in stock</option>
        </select>
        <button
          type="button"
          onClick={() => update("dir", sortDir === "desc" ? null : "desc")}
          aria-pressed={sortDir === "desc"}
          aria-label={sortDir === "desc" ? "Sort descending" : "Sort ascending"}
          title={sortDir === "desc" ? "Descending (high → low) — click for ascending" : "Ascending (low → high) — click for descending"}
          className={pill(sortDir === "desc")}
        >
          <span aria-hidden="true">{sortDir === "desc" ? "↓" : "↑"}</span>{" "}
          {sortDir === "desc" ? "Desc" : "Asc"}
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
      <div className="w-20 shrink-0 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5 flex-1">{children}</div>
    </div>
  );
}
