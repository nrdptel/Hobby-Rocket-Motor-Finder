"use client";

import { useEffect, useState } from "react";

import {
  rocketInStockCount,
  useRockets,
  type Rocket,
  type RocketInput,
  type RocketMotor,
} from "@/lib/rockets";
import { useCatalogFilters } from "./CatalogFilters";
import type { CaseOption } from "@/lib/derive";
import { RocketNotifyButton } from "./RocketNotifyButton";

type CertLevel = { key: string; label: string; sublabel: string };

/** "My rockets": browser-saved motor-mount profiles. The mount diameter is the
 * only required field; a rocket may also pin a cert level, a single impulse
 * class, a reload case, and/or an impulse band. Clicking one filters the catalog
 * to the motors that fit — the heart of the finder. Sits above the filter bar;
 * applying a rocket sets the matching URL params (`cert`/`dia`/`class`/`case`/
 * `imin`/`imax`) so the filter bar reflects it automatically. */
export function MyRockets({
  diameters,
  certLevels,
  classes,
  cases,
  motors,
}: {
  diameters: number[];
  certLevels: CertLevel[];
  classes: string[];
  cases: CaseOption[];
  motors: RocketMotor[];
}) {
  const { params: sp, replace } = useCatalogFilters();
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

  if (diameters.length === 0) return null;

  const certLabel = (key: string) =>
    certLevels.find((c) => c.key === key)?.label ?? key;

  const ROCKET_PARAMS = ["cert", "dia", "class", "case", "imin", "imax"] as const;

  const numParamEq = (param: string, val: number | null) =>
    val == null ? !sp.get(param) : sp.get(param) === String(val);
  const strParamEq = (param: string, val: string | null) =>
    val == null ? !sp.get(param) : sp.get(param) === val;

  const isActive = (r: Rocket) =>
    sp.get("dia") === String(r.diameterMm) &&
    strParamEq("cert", r.cert) &&
    strParamEq("class", r.impulseClass) &&
    strParamEq("case", r.caseInfo) &&
    numParamEq("imin", r.minImpulseNs) &&
    numParamEq("imax", r.maxImpulseNs);

  // Apply a wholesale filter change through the client store (instant, no
  // navigation; URL kept in sync for sharing).
  const pushParams = (next: URLSearchParams) => replace(next);

  type Spec = Pick<
    Rocket,
    "cert" | "diameterMm" | "impulseClass" | "caseInfo" | "minImpulseNs" | "maxImpulseNs"
  >;

  // Set the filters from a rocket spec: each optional field is set when present
  // and cleared when not. Always sets — never toggles.
  const setFiltersFromSpec = (s: Spec) => {
    const next = new URLSearchParams(sp.toString());
    next.set("dia", String(s.diameterMm));
    const put = (param: string, val: string | null) =>
      val ? next.set(param, val) : next.delete(param);
    put("cert", s.cert);
    put("class", s.impulseClass);
    put("case", s.caseInfo);
    put("imin", s.minImpulseNs != null ? String(s.minImpulseNs) : null);
    put("imax", s.maxImpulseNs != null ? String(s.maxImpulseNs) : null);
    pushParams(next);
  };

  const apply = (r: Rocket) => {
    if (isActive(r)) {
      // Toggle off — clear this rocket's filters.
      const next = new URLSearchParams(sp.toString());
      for (const p of ROCKET_PARAMS) next.delete(p);
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

  // Compact spec summary for a rocket without a name. Diameter always; then the
  // most specific narrowing it sets, so an unlabeled rocket still reads clearly.
  const specSummary = (r: Rocket): string => {
    const parts = [`${r.diameterMm}mm`];
    if (r.cert) parts.push(certLabel(r.cert));
    if (r.impulseClass) parts.push(`${r.impulseClass}-class`);
    if (r.caseInfo) parts.push(r.caseInfo);
    return parts.join(" · ");
  };

  const label = (r: Rocket) => r.name || specSummary(r);

  // Shared styling for the edit/delete segments of a rocket chip.
  const edge = (active: boolean) =>
    active
      ? "border-zinc-900 bg-zinc-900 text-zinc-300 hover:text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-500 dark:hover:text-zinc-900"
      : "border-zinc-300 bg-white text-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:text-zinc-200";

  // "Save current view as a rocket": offered when the current filters describe a
  // single rocket — one diameter (the only requirement), plus at most a single
  // cert/class/case and an impulse band — that isn't already saved, so a flyer
  // who's dialed in their filters can persist them in one click.
  const numParam = (p: string): number | null => {
    const v = sp.get(p);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  // A param that holds exactly one value (no comma list), or null.
  const singleParam = (p: string): string | null => {
    const v = sp.get(p);
    return v && !v.includes(",") ? v : null;
  };
  const curDia = singleParam("dia");
  const curCert = singleParam("cert");
  const curSpec: RocketInput | null =
    curDia && Number.isFinite(Number(curDia))
      ? {
          diameterMm: Number(curDia),
          cert: curCert && certLevels.some((c) => c.key === curCert) ? curCert : null,
          impulseClass: singleParam("class"),
          caseInfo: singleParam("case"),
          minImpulseNs: numParam("imin"),
          maxImpulseNs: numParam("imax"),
        }
      : null;
  const alreadySaved =
    curSpec != null &&
    rockets.some(
      (r) =>
        r.cert === (curSpec.cert ?? null) &&
        r.diameterMm === curSpec.diameterMm &&
        r.impulseClass === (curSpec.impulseClass ?? null) &&
        r.caseInfo === (curSpec.caseInfo ?? null) &&
        r.minImpulseNs === (curSpec.minImpulseNs ?? null) &&
        r.maxImpulseNs === (curSpec.maxImpulseNs ?? null),
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
                    specSummary(r)
                  }${band(r) ? `, ${band(r)}` : ""}`}
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
                <RocketNotifyButton
                  name={r.name}
                  displayLabel={label(r)}
                  diameterMm={r.diameterMm}
                  cert={r.cert}
                  impulseClass={r.impulseClass}
                  caseInfo={r.caseInfo}
                  minImpulseNs={r.minImpulseNs}
                  maxImpulseNs={r.maxImpulseNs}
                  active={active}
                />
              </span>
            );
          })}

        {hydrated && rockets.length === 0 && !showAdd && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Save your rocket to filter by what fits it in one tap.
          </span>
        )}

        {canSaveCurrent && curSpec && (
          <button
            type="button"
            onClick={() => add(curSpec)}
            title="Save the current diameter (+ cert/class/case/impulse) filters as a rocket"
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
          classes={classes}
          cases={cases}
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
  classes,
  cases,
  initial,
  submitLabel,
  onSubmit,
}: {
  diameters: number[];
  certLevels: CertLevel[];
  classes: string[];
  cases: CaseOption[];
  initial?: Rocket;
  submitLabel: string;
  onSubmit: (spec: {
    name?: string;
    diameterMm: number;
    cert: string | null;
    impulseClass: string | null;
    caseInfo: string | null;
    minImpulseNs: number | null;
    maxImpulseNs: number | null;
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [diameter, setDiameter] = useState(
    String(initial?.diameterMm ?? diameters[0]),
  );
  // All narrowings are optional ("" = Any). Diameter is the only required field.
  const [cert, setCert] = useState(initial?.cert ?? "");
  const [impulseClass, setImpulseClass] = useState(initial?.impulseClass ?? "");
  const [caseInfo, setCaseInfo] = useState(initial?.caseInfo ?? "");
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

  // Cases offered for the selected mount: that diameter's hardware, plus "Single
  // use" (diameter null), which spans diameters. If the chosen case no longer
  // belongs after a diameter change, it's dropped on submit (see caseValue).
  const dnum = Number(diameter);
  const caseChoices = cases.filter((c) => c.diameter == null || c.diameter === dnum);
  const caseValue = caseChoices.some((c) => c.value === caseInfo) ? caseInfo : "";

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
          diameterMm: dnum,
          cert: cert || null,
          impulseClass: impulseClass || null,
          caseInfo: caseValue || null,
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
      {certLevels.length > 0 && (
        <label className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          My cert <span className="opacity-60">(optional)</span>
          <select value={cert} onChange={(e) => setCert(e.target.value)} className={selectCls}>
            <option value="">Any</option>
            {certLevels.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({c.sublabel})
              </option>
            ))}
          </select>
        </label>
      )}
      {classes.length > 0 && (
        <label className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Class <span className="opacity-60">(optional)</span>
          <select
            value={impulseClass}
            onChange={(e) => setImpulseClass(e.target.value)}
            className={selectCls}
          >
            <option value="">Any</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}
      {caseChoices.length > 0 && (
        <label className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Case <span className="opacity-60">(optional)</span>
          <select
            value={caseValue}
            onChange={(e) => setCaseInfo(e.target.value)}
            className={selectCls}
          >
            <option value="">Any</option>
            {caseChoices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.value}
                {c.manufacturer ? ` · ${c.manufacturer}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
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
