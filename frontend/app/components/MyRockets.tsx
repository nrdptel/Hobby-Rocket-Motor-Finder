"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useRockets, type Rocket } from "@/lib/rockets";

type CertLevel = { key: string; label: string; sublabel: string };

/** "My rockets": browser-saved {diameter + cert} profiles. Clicking one filters
 * the catalog to the motors that fit that mount AND the flyer is rated to fly —
 * the heart of the finder. Sits above the filter bar; applying a rocket just
 * sets the `cert` + `dia` URL params (and clears `class`, which would otherwise
 * intersect to nothing), so the filter bar reflects it automatically. */
export function MyRockets({
  diameters,
  certLevels,
}: {
  diameters: number[];
  certLevels: CertLevel[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const { rockets, add, remove, hydrated } = useRockets();
  const [showAdd, setShowAdd] = useState(false);

  if (diameters.length === 0 || certLevels.length === 0) return null;

  const certLabel = (key: string) =>
    certLevels.find((c) => c.key === key)?.label ?? key;

  const paramEq = (param: string, val: number | null) =>
    val == null ? !sp.get(param) : sp.get(param) === String(val);

  const isActive = (r: Rocket) =>
    sp.get("cert") === r.cert &&
    sp.get("dia") === String(r.diameterMm) &&
    paramEq("imin", r.minImpulseNs) &&
    paramEq("imax", r.maxImpulseNs);

  const apply = (r: Rocket) => {
    const next = new URLSearchParams(sp.toString());
    if (isActive(r)) {
      // Toggle off — clear this rocket's filters.
      for (const p of ["cert", "dia", "imin", "imax"]) next.delete(p);
    } else {
      next.set("cert", r.cert);
      next.set("dia", String(r.diameterMm));
      next.delete("class"); // class ∩ cert would usually be empty
      if (r.minImpulseNs != null) next.set("imin", String(r.minImpulseNs));
      else next.delete("imin");
      if (r.maxImpulseNs != null) next.set("imax", String(r.maxImpulseNs));
      else next.delete("imax");
    }
    const qs = next.toString();
    router.push(qs ? `/?${qs}` : "/", { scroll: false });
  };

  const band = (r: Rocket): string => {
    const { minImpulseNs: lo, maxImpulseNs: hi } = r;
    if (lo == null && hi == null) return "";
    if (lo != null && hi != null) return `${lo}–${hi} N·s`;
    return lo != null ? `≥${lo} N·s` : `≤${hi} N·s`;
  };

  const label = (r: Rocket) =>
    r.name || `${r.diameterMm}mm · ${certLabel(r.cert)}`;

  return (
    <section className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          My rockets
        </span>

        {hydrated &&
          rockets.map((r) => {
            const active = isActive(r);
            return (
              <span key={r.id} className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => apply(r)}
                  aria-pressed={active}
                  title={`Show in-stock ${r.diameterMm}mm motors you can fly at ${certLabel(r.cert)}${
                    band(r) ? `, ${band(r)}` : ""
                  }`}
                  className={`inline-flex items-center gap-1 rounded-l-full border py-0.5 pl-2.5 pr-2 text-xs font-medium transition ${
                    active
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  🚀 {label(r)}
                </button>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  aria-label={`Delete rocket ${label(r)}`}
                  title="Delete this rocket"
                  className={`rounded-r-full border border-l-0 px-1.5 py-0.5 text-xs transition ${
                    active
                      ? "border-zinc-900 bg-zinc-900 text-zinc-300 hover:text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-500 dark:hover:text-zinc-900"
                      : "border-zinc-300 bg-white text-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:text-zinc-200"
                  }`}
                >
                  ×
                </button>
              </span>
            );
          })}

        {hydrated && rockets.length === 0 && !showAdd && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Save your rocket to filter by what fits + your cert in one tap.
          </span>
        )}

        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          aria-expanded={showAdd}
          className="rounded-full border border-dashed border-zinc-400 px-2.5 py-0.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {showAdd ? "Cancel" : "+ Add rocket"}
        </button>
      </div>

      {showAdd && (
        <AddRocketForm
          diameters={diameters}
          certLevels={certLevels}
          onAdd={(spec) => {
            const r = add(spec);
            setShowAdd(false);
            apply(r);
          }}
        />
      )}
    </section>
  );
}

function AddRocketForm({
  diameters,
  certLevels,
  onAdd,
}: {
  diameters: number[];
  certLevels: CertLevel[];
  onAdd: (spec: {
    name?: string;
    diameterMm: number;
    cert: string;
    minImpulseNs: number | null;
    maxImpulseNs: number | null;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [diameter, setDiameter] = useState(String(diameters[0]));
  // Prefer L1 as the sensible default cert if present.
  const [cert, setCert] = useState(
    certLevels.find((c) => c.key === "l1")?.key ?? certLevels[0].key,
  );
  const [imin, setImin] = useState("");
  const [imax, setImax] = useState("");

  // Parse an optional non-negative impulse bound; blank/invalid/negative → null.
  const bound = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const selectCls =
    "rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
  const inputCls =
    "w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd({
          name,
          diameterMm: Number(diameter),
          cert,
          minImpulseNs: bound(imin),
          maxImpulseNs: bound(imax),
        });
      }}
      className="mt-3 flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
    >
      <label className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        Name <span className="opacity-60">(optional)</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Wildman Punisher"
          className="w-44 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
      </label>
      <label className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        Motor mount
        <select value={diameter} onChange={(e) => setDiameter(e.target.value)} className={selectCls}>
          {diameters.map((d) => (
            <option key={d} value={d}>
              {d}mm
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        My cert
        <select value={cert} onChange={(e) => setCert(e.target.value)} className={selectCls}>
          {certLevels.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label} ({c.sublabel})
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        Impulse <span className="opacity-60">N·s (optional)</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={imin}
            onChange={(e) => setImin(e.target.value)}
            placeholder="min"
            aria-label="Minimum total impulse for this rocket, N·s"
            className={inputCls}
          />
          <span>–</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={imax}
            onChange={(e) => setImax(e.target.value)}
            placeholder="max"
            aria-label="Maximum total impulse for this rocket, N·s"
            className={inputCls}
          />
        </div>
      </div>
      <button
        type="submit"
        className="rounded-full border border-zinc-900 bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-zinc-700 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Add &amp; show
      </button>
    </form>
  );
}
