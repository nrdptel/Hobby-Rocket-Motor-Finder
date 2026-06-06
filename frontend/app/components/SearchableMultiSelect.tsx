"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SelectOption = {
  // The value stored in the URL filter + passed to onToggle (e.g. a vendor slug,
  // a case code, a propellant name).
  value: string;
  // What the user sees in the dropdown row + chip. Defaults to `value` when the
  // display text and the stored value are the same (cases, propellants).
  label?: string;
  // Heading this option is filed under (e.g. "54mm", "AeroTech"). Options are
  // grouped by this, preserving first-seen order, so the caller controls group
  // order via the order of the `options` array. Omit for a flat, ungrouped list.
  group?: string;
  // Muted right-aligned label inside the dropdown row + on the chip (e.g. the
  // brand for a reload case). null hides it.
  sublabel?: string | null;
};

/** Searchable, optionally-grouped multi-select used for filter dimensions with
 * too many values to show as a flat pill row (reload cases ~90, propellants ~36,
 * vendors ~10). The audience knows their hardware, so the primary path is
 * type-to-find; the checklist is for browsing. Selected values show as removable
 * chips so the choice stays visible without reopening the panel. Caller owns the
 * option list, sort, and grouping; this is purely presentational. */
export function SearchableMultiSelect({
  options,
  active,
  onToggle,
  onClear,
  noun,
  placeholder,
  mono = false,
}: {
  options: SelectOption[];
  active: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
  /** Singular noun for the trigger label — "Any {noun}" / "{n} {noun}s". */
  noun: string;
  /** Search-box placeholder, e.g. "type a case — 38/720, pro38…". */
  placeholder: string;
  /** Render option values + chips in a monospaced font (case codes). */
  mono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // value → display text + sublabel, so selected chips (rebuilt from raw URL
  // values) can render their friendly label, not the stored value.
  const labelOf = useMemo(
    () => new Map(options.map((o) => [o.value, o.label ?? o.value])),
    [options],
  );
  const sublabelOf = useMemo(
    () => new Map(options.map((o) => [o.value, o.sublabel ?? null])),
    [options],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? options.filter((o) => (o.label ?? o.value).toLowerCase().includes(q))
      : options;
    const m = new Map<string, SelectOption[]>();
    for (const o of list) {
      const key = o.group ?? "";
      const arr = m.get(key);
      if (arr) arr.push(o);
      else m.set(key, [o]);
    }
    return m;
  }, [options, query]);

  const valueCls = mono ? "font-mono text-xs" : "text-xs";

  return (
    <div ref={ref} className="relative flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-2.5 py-0.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        {active.size > 0 ? `${active.size} ${noun}${active.size > 1 ? "s" : ""}` : `Any ${noun}`}
        <span aria-hidden className="opacity-60">▾</span>
      </button>

      {Array.from(active).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onToggle(v)}
          title={`Remove this ${noun}`}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-900 bg-zinc-900 px-2.5 py-0.5 text-xs text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
        >
          <span className={mono ? "font-mono" : undefined}>{labelOf.get(v) ?? v}</span>
          {sublabelOf.get(v) && (
            <span className="font-normal opacity-50">{sublabelOf.get(v)}</span>
          )}
          <span aria-hidden className="opacity-70">×</span>
        </button>
      ))}
      {active.size > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          clear
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-80 w-72 overflow-auto rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={`Search ${noun}s`}
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <div className="mt-2 space-y-2">
            {Array.from(groups.entries()).map(([group, opts]) => (
              <div key={group || "_"}>
                {group && (
                  <div className="px-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    {group}
                  </div>
                )}
                {opts.map((o) => (
                  <label
                    key={o.value}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <input
                      type="checkbox"
                      checked={active.has(o.value)}
                      onChange={() => onToggle(o.value)}
                      className="accent-zinc-900 dark:accent-zinc-100"
                    />
                    <span className={`${valueCls} text-zinc-800 dark:text-zinc-200`}>
                      {o.label ?? o.value}
                    </span>
                    {o.sublabel && (
                      <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">
                        {o.sublabel}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            ))}
            {groups.size === 0 && (
              <div className="px-1 py-2 text-xs text-zinc-400">No matching {noun}s</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
