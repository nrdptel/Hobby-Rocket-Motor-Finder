"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  rocketInStockCount,
  useRockets,
  type Rocket,
  type RocketMotor,
} from "@/lib/rockets";

type CertLevel = { key: string; label: string; sublabel: string };

/** "My rockets": browser-saved {diameter + cert} profiles. Clicking one filters
 * the catalog to the motors that fit that mount AND the flyer is rated to fly —
 * the heart of the finder. Sits above the filter bar; applying a rocket just
 * sets the `cert` + `dia` URL params (and clears `class`, which would otherwise
 * intersect to nothing), so the filter bar reflects it automatically. */
export function MyRockets({
  diameters,
  certLevels,
  motors,
}: {
  diameters: number[];
  certLevels: CertLevel[];
  motors: RocketMotor[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const { rockets, add, update, remove, restore, hydrated } = useRockets();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Last-deleted rocket (+ its position), kept briefly so a misclick on × can be
  // undone rather than silently losing a configured profile.
  const [undo, setUndo] = useState<{ rocket: Rocket; index: number } | null>(null);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

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

  const pushParams = (next: URLSearchParams) => {
    const qs = next.toString();
    router.push(qs ? `/?${qs}` : "/", { scroll: false });
  };

  type Spec = Pick<Rocket, "cert" | "diameterMm" | "minImpulseNs" | "maxImpulseNs">;

  // Set the cert/dia/impulse filters from a rocket spec (clearing class, which
  // would intersect cert to nothing). Always sets — never toggles.
  const setFiltersFromSpec = (s: Spec) => {
    const next = new URLSearchParams(sp.toString());
    next.set("cert", s.cert);
    next.set("dia", String(s.diameterMm));
    next.delete("class");
    if (s.minImpulseNs != null) next.set("imin", String(s.minImpulseNs));
    else next.delete("imin");
    if (s.maxImpulseNs != null) next.set("imax", String(s.maxImpulseNs));
    else next.delete("imax");
    pushParams(next);
  };

  const apply = (r: Rocket) => {
    if (isActive(r)) {
      // Toggle off — clear this rocket's filters.
      const next = new URLSearchParams(sp.toString());
      for (const p of ["cert", "dia", "imin", "imax"]) next.delete(p);
      pushParams(next);
    } else {
      setFiltersFromSpec(r);
    }
  };

  const band = (r: Rocket): string => {
    const { minImpulseNs: lo, maxImpulseNs: hi } = r;
    if (lo == null && hi == null) return "";
    if (lo != null && hi != null) return `${lo}–${hi} N·s`;
    return lo != null ? `≥${lo} N·s` : `≤${hi} N·s`;
  };

  const label = (r: Rocket) =>
    r.name || `${r.diameterMm}mm · ${certLabel(r.cert)}`;

  // Shared styling for the edit/delete segments of a rocket chip.
  const edge = (active: boolean) =>
    active
      ? "border-zinc-900 bg-zinc-900 text-zinc-300 hover:text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-500 dark:hover:text-zinc-900"
      : "border-zinc-300 bg-white text-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:text-zinc-200";

  // "Save current view as a rocket": offered when the current filters describe a
  // single rocket (one cert + one diameter) that isn't already saved — so a
  // flyer who's dialed in cert/diameter/impulse can persist it in one click.
  const numParam = (p: string): number | null => {
    const v = sp.get(p);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const curCert = sp.get("cert");
  const curDia = sp.get("dia");
  const curSpec =
    curCert &&
    !curCert.includes(",") &&
    certLevels.some((c) => c.key === curCert) &&
    curDia &&
    !curDia.includes(",") &&
    Number.isFinite(Number(curDia))
      ? {
          diameterMm: Number(curDia),
          cert: curCert,
          minImpulseNs: numParam("imin"),
          maxImpulseNs: numParam("imax"),
        }
      : null;
  const alreadySaved =
    curSpec != null &&
    rockets.some(
      (r) =>
        r.cert === curSpec.cert &&
        r.diameterMm === curSpec.diameterMm &&
        r.minImpulseNs === curSpec.minImpulseNs &&
        r.maxImpulseNs === curSpec.maxImpulseNs,
    );
  const canSaveCurrent =
    hydrated && curSpec != null && !alreadySaved && !showAdd && !editingId;
  const editingRocket = editingId ? rockets.find((r) => r.id === editingId) : undefined;

  return (
    <section className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          My rockets
        </span>

        {hydrated &&
          rockets.map((r) => {
            const active = isActive(r);
            const count = rocketInStockCount(r, motors);
            return (
              <span key={r.id} className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => apply(r)}
                  aria-pressed={active}
                  title={`${count} in-stock motor${count === 1 ? "" : "s"} fit this rocket — ${
                    r.diameterMm
                  }mm, ${certLabel(r.cert)}${band(r) ? `, ${band(r)}` : ""}`}
                  className={`inline-flex items-center gap-1 rounded-l-full border py-0.5 pl-2.5 pr-2 text-xs font-medium transition ${
                    active
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  🚀 {label(r)}
                  <span
                    className={
                      count > 0
                        ? active
                          ? "opacity-80"
                          : "text-emerald-600 dark:text-emerald-400"
                        : "opacity-50"
                    }
                  >
                    ({count})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(r.id);
                    setShowAdd(false);
                  }}
                  aria-label={`Edit rocket ${label(r)}`}
                  title="Edit this rocket"
                  className={`border border-l-0 px-1.5 py-0.5 text-xs transition ${edge(active)}`}
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const index = rockets.findIndex((x) => x.id === r.id);
                    if (editingId === r.id) setEditingId(null);
                    remove(r.id);
                    setUndo({ rocket: r, index });
                  }}
                  aria-label={`Delete rocket ${label(r)}`}
                  title="Delete this rocket"
                  className={`rounded-r-full border border-l-0 px-1.5 py-0.5 text-xs transition ${edge(active)}`}
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

        {canSaveCurrent && curSpec && (
          <button
            type="button"
            onClick={() => add(curSpec)}
            title="Save the current cert + diameter (+ impulse) filters as a rocket"
            className="rounded-full border border-emerald-400 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-700/60 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
          >
            ＋ Save current view
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            if (editingId) setEditingId(null); // cancel an in-progress edit
            else setShowAdd((v) => !v);
          }}
          aria-expanded={showAdd || editingId != null}
          className="rounded-full border border-dashed border-zinc-400 px-2.5 py-0.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {showAdd || editingId ? "Cancel" : "+ Add rocket"}
        </button>
      </div>

      {undo && (
        <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>Deleted “{label(undo.rocket)}”.</span>
          <button
            type="button"
            onClick={() => {
              restore(undo.rocket, undo.index);
              setUndo(null);
            }}
            className="font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            Undo
          </button>
        </div>
      )}

      {(showAdd || editingRocket) && (
        <RocketForm
          key={editingRocket?.id ?? "add"}
          diameters={diameters}
          certLevels={certLevels}
          initial={editingRocket}
          submitLabel={editingRocket ? "Save changes" : "Add & show"}
          onSubmit={(spec) => {
            if (editingRocket) {
              const wasActive = isActive(editingRocket);
              update(editingRocket.id, spec);
              setEditingId(null);
              if (wasActive) setFiltersFromSpec({ ...spec });
            } else {
              const r = add(spec);
              setShowAdd(false);
              apply(r);
            }
          }}
        />
      )}
    </section>
  );
}

function RocketForm({
  diameters,
  certLevels,
  initial,
  submitLabel,
  onSubmit,
}: {
  diameters: number[];
  certLevels: CertLevel[];
  initial?: Rocket;
  submitLabel: string;
  onSubmit: (spec: {
    name?: string;
    diameterMm: number;
    cert: string;
    minImpulseNs: number | null;
    maxImpulseNs: number | null;
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [diameter, setDiameter] = useState(
    String(initial?.diameterMm ?? diameters[0]),
  );
  const [cert, setCert] = useState(
    // Edit: the rocket's cert. Add: prefer L1 as the sensible default.
    initial?.cert ?? certLevels.find((c) => c.key === "l1")?.key ?? certLevels[0].key,
  );
  const [imin, setImin] = useState(
    initial?.minImpulseNs != null ? String(initial.minImpulseNs) : "",
  );
  const [imax, setImax] = useState(
    initial?.maxImpulseNs != null ? String(initial.maxImpulseNs) : "",
  );

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
        onSubmit({
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
        {submitLabel}
      </button>
    </form>
  );
}
