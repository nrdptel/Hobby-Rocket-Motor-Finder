"use client";

import { useEffect, useState } from "react";
import { BURN_LABEL, numericParamValue, searchParamValue } from "@/lib/derive";
import type { BurnCharacter, CaseOption, PropellantOption, VendorOption } from "@/lib/derive";
import { useWatchlist } from "@/lib/watchlist";
import { useCatalogFilters } from "./CatalogFilters";
import { CaseFilter } from "./CaseFilter";
import { PropellantFilter } from "./PropellantFilter";
import { VendorFilter } from "./VendorFilter";

type Props = {
  manufacturers: string[];
  classes: string[];
  diameters: number[];
  certLevels: { key: string; label: string; sublabel: string }[];
  cases: CaseOption[];
  propellants: PropellantOption[];
  vendors: VendorOption[];
};

// Burn-character keys in display order (low → high duration).
const BURN_KEYS: readonly BurnCharacter[] = ["punchy", "standard", "long"];

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
  cases,
  propellants,
  vendors,
}: Props) {
  const { params: sp, update, clearAll } = useCatalogFilters();
  const { count: starredCount, clear: clearWatchlist, hydrated } = useWatchlist();
  const [copied, setCopied] = useState(false);

  const activeManufacturers = parseList(sp.get("mfr"));
  const activeClasses = parseList(sp.get("class"));
  const activeDiameters = parseList(sp.get("dia"));
  const activeCert = parseList(sp.get("cert"));
  const activeCases = parseList(sp.get("case"));
  const activePropellants = parseList(sp.get("prop"));
  const activeVendors = parseList(sp.get("vendor"));
  const activeBurn = parseList(sp.get("burn"));
  const sparkyOnly = sp.get("sparky") === "1";
  const inStockOnly = sp.get("in_stock") === "1";
  const sortOrder = sp.get("order") ?? "class";
  const sortDir = sp.get("dir") === "desc" ? "desc" : "asc";
  const starredOnly = sp.get("starred") === "1";
  const urlQuery = sp.get("q") ?? "";
  const urlMinImpulse = sp.get("imin") ?? "";
  const urlMaxImpulse = sp.get("imax") ?? "";
  const urlMinPrice = sp.get("pmin") ?? "";
  const urlMaxPrice = sp.get("pmax") ?? "";

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
  const [minPrice, setMinPrice] = useDebouncedParam("pmin", urlMinPrice, update, numericParamValue);
  const [maxPrice, setMaxPrice] = useDebouncedParam("pmax", urlMaxPrice, update, numericParamValue);

  const toggleMfr = (m: string) => update("mfr", toggleInList(activeManufacturers, m));
  const toggleClass = (c: string) => update("class", toggleInList(activeClasses, c));
  const toggleDia = (d: number) =>
    update("dia", toggleInList(activeDiameters, String(d)));
  const toggleCert = (key: string) => update("cert", toggleInList(activeCert, key));
  const toggleCase = (v: string) => update("case", toggleInList(activeCases, v));
  const togglePropellant = (v: string) => update("prop", toggleInList(activePropellants, v));
  const toggleVendor = (slug: string) => update("vendor", toggleInList(activeVendors, slug));
  const toggleBurn = (k: string) => update("burn", toggleInList(activeBurn, k));
  const toggleSparky = () => update("sparky", sparkyOnly ? null : "1");
  const toggleStock = () => update("in_stock", inStockOnly ? null : "1");
  const toggleStarred = () => update("starred", starredOnly ? null : "1");

  const anyFilter =
    activeManufacturers.size > 0 ||
    activeClasses.size > 0 ||
    activeDiameters.size > 0 ||
    activeCert.size > 0 ||
    activeCases.size > 0 ||
    activePropellants.size > 0 ||
    activeVendors.size > 0 ||
    activeBurn.size > 0 ||
    sparkyOnly ||
    inStockOnly ||
    sortOrder !== "class" ||
    sortDir !== "asc" ||
    starredOnly ||
    urlQuery.length > 0 ||
    urlMinImpulse.length > 0 ||
    urlMaxImpulse.length > 0 ||
    urlMinPrice.length > 0 ||
    urlMaxPrice.length > 0;

  // Secondary filters live behind a "More filters" disclosure so the default
  // panel stays short (the common path is search / brand / class / diameter /
  // stock). It auto-opens whenever one of these is active — e.g. landing on a
  // shared link with a price band — so an applied filter is never hidden.
  const advancedActive =
    activeVendors.size > 0 ||
    activeCases.size > 0 ||
    activePropellants.size > 0 ||
    activeBurn.size > 0 ||
    sparkyOnly ||
    urlMinImpulse.length > 0 ||
    urlMaxImpulse.length > 0 ||
    urlMinPrice.length > 0 ||
    urlMaxPrice.length > 0;
  const [showAdvanced, setShowAdvanced] = useState(advancedActive);
  useEffect(() => {
    if (advancedActive) setShowAdvanced(true);
  }, [advancedActive]);

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
    `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-offset-zinc-900 ${
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-20 shrink-0" aria-hidden />
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="inline-flex items-center gap-1 rounded-md px-1 text-xs font-medium text-zinc-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-50 dark:text-zinc-300 dark:focus-visible:ring-offset-zinc-900"
        >
          <span aria-hidden="true">{showAdvanced ? "▾" : "▸"}</span>
          {showAdvanced ? "Fewer filters" : "More filters"}
          <span className="font-normal text-zinc-400 dark:text-zinc-500">
            vendor · case · propellant · character · impulse · price
          </span>
        </button>
      </div>

      {showAdvanced && (
        <>
          {vendors.length > 1 && (
            <FilterRow label="Vendor">
              <VendorFilter
                options={vendors}
                active={activeVendors}
                onToggle={toggleVendor}
                onClear={() => update("vendor", null)}
              />
            </FilterRow>
          )}

          {cases.length > 0 && (
            <FilterRow label="Case">
              <CaseFilter
                options={cases}
                active={activeCases}
                onToggle={toggleCase}
                onClear={() => update("case", null)}
              />
            </FilterRow>
          )}

          {propellants.length > 0 && (
            <FilterRow label="Propellant">
              <PropellantFilter
                options={propellants}
                active={activePropellants}
                onToggle={togglePropellant}
                onClear={() => update("prop", null)}
              />
            </FilterRow>
          )}

          <FilterRow label="Character">
        {BURN_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => toggleBurn(k)}
            aria-pressed={activeBurn.has(k)}
            className={pill(activeBurn.has(k))}
            title={
              k === "punchy"
                ? "Short, snappy burn (under 1.5 s)"
                : k === "long"
                  ? "Long, sustained burn (3 s or more)"
                  : "Standard burn (1.5–3 s)"
            }
          >
            {BURN_LABEL[k]}
          </button>
        ))}
        <button
          type="button"
          onClick={toggleSparky}
          aria-pressed={sparkyOnly}
          className={pill(sparkyOnly)}
          title="Sparky propellant — throws gold sparks (great at night; often restricted under fire bans)"
        >
          Sparky
        </button>
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

      <FilterRow label="Price">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="text-zinc-500">$</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            placeholder="min"
            className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            aria-label="Minimum price in dollars (cheapest in stock)"
          />
          <span>–</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="max"
            className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            aria-label="Maximum price in dollars (cheapest in stock)"
          />
          <span className="text-zinc-500">cheapest in stock</span>
        </div>
      </FilterRow>
        </>
      )}

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
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:focus-visible:ring-offset-zinc-900"
        >
          <option value="class">Class (default)</option>
          <option value="impulse">Total impulse</option>
          <option value="thrust">Avg thrust</option>
          <option value="diameter">Diameter</option>
          <option value="price">Price</option>
          <option value="isp">Specific impulse</option>
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
        {sortOrder === "price" && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            cheapest across all vendors — add &ldquo;In stock only&rdquo; for buyable prices
          </span>
        )}
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
