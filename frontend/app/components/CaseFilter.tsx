"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SINGLE_USE_CASE } from "@/lib/derive";
import type { CaseOption } from "@/lib/derive";

/** Searchable, diameter-grouped multi-select for reload cases. Used instead of a
 * flat pill row because there are ~90 distinct cases — far too many to list. The
 * audience knows their hardware, so the primary path is type-to-find ("38/720",
 * "pro38"); the grouped checklist is for browsing. Selected cases show as
 * removable chips so the choice is visible without reopening the panel. */
export function CaseFilter({
  options,
  active,
  onToggle,
  onClear,
}: {
  options: CaseOption[];
  active: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
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

  // case value → brand, so selected chips (built from URL values) can show it.
  const brandOf = useMemo(
    () => new Map(options.map((o) => [o.value, o.manufacturer])),
    [options],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => o.value.toLowerCase().includes(q)) : options;
    const m = new Map<string, CaseOption[]>();
    for (const o of list) {
      const g = o.diameter == null ? SINGLE_USE_CASE : `${o.diameter}mm`;
      const arr = m.get(g);
      if (arr) arr.push(o);
      else m.set(g, [o]);
    }
    return m;
  }, [options, query]);

  return (
    <div ref={ref} className="relative flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-2.5 py-0.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        {active.size > 0 ? `${active.size} case${active.size > 1 ? "s" : ""}` : "Any case"}
        <span aria-hidden className="opacity-60">▾</span>
      </button>

      {Array.from(active).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onToggle(v)}
          title="Remove this case"
          className="inline-flex items-center gap-1 rounded-full border border-zinc-900 bg-zinc-900 px-2.5 py-0.5 font-mono text-xs text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {v}
          {brandOf.get(v) && (
            <span className="font-sans font-normal opacity-50">{brandOf.get(v)}</span>
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
            placeholder="type a case — 38/720, pro38…"
            aria-label="Search reload cases"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <div className="mt-2 space-y-2">
            {Array.from(groups.entries()).map(([group, opts]) => (
              <div key={group}>
                <div className="px-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  {group}
                </div>
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
                    <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">{o.value}</span>
                    {o.manufacturer && (
                      <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">
                        {o.manufacturer}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            ))}
            {groups.size === 0 && (
              <div className="px-1 py-2 text-xs text-zinc-400">No matching cases</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
