"use client";

import { useEffect, useState } from "react";

import {
  ROCKET_PARAMS,
  rocketInStockCount,
  rocketMatchesParams,
  useRockets,
  type Rocket,
  type RocketInput,
  type RocketMotor,
} from "@/lib/rockets";
import { useCatalogFilters } from "./CatalogFilters";
import type { CaseOption } from "@/lib/derive";
import { CaseFilter } from "./CaseFilter";
import { RocketNotifyButton } from "./RocketNotifyButton";
import { SearchableMultiSelect, type SelectOption } from "./SearchableMultiSelect";

/** "My rockets": browser-saved motor-mount profiles. The mount diameter is the
 * only required field; a rocket may also pin one or more impulse classes, one or
 * more reload cases (e.g. every case it can fly), and/or an impulse band.
 * Clicking one filters the catalog to the motors that fit — the heart of the
 * finder. Sits above the filter bar; applying a rocket sets the matching URL
 * params (`dia`/`class`/`case`/`imin`/`imax`) so the filter bar reflects it
 * automatically. */
export function MyRockets({
  diameters,
  classes,
  cases,
  motors,
}: {
  diameters: number[];
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

  const isActive = (r: Rocket) => rocketMatchesParams(r, (k) => sp.get(k));

  // Apply a wholesale filter change through the client store (instant, no
  // navigation; URL kept in sync for sharing).
  const pushParams = (next: URLSearchParams) => replace(next);

  type Spec = Pick<
    Rocket,
    "diameterMm" | "impulseClasses" | "caseInfos" | "minImpulseNs" | "maxImpulseNs"
  >;

  // Set the filters from a rocket spec: each optional field is set when present
  // and cleared when not. Always sets — never toggles. (Cert is left untouched:
  // a rocket doesn't pin one, so the catalog's own cert filter is independent.)
  const setFiltersFromSpec = (s: Spec) => {
    const next = new URLSearchParams(sp.toString());
    next.set("dia", String(s.diameterMm));
    const put = (param: string, val: string | null) =>
      val ? next.set(param, val) : next.delete(param);
    put("class", s.impulseClasses.length ? s.impulseClasses.join(",") : null);
    put("case", s.caseInfos.length ? s.caseInfos.join(",") : null);
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
    if (r.impulseClasses.length) parts.push(`${r.impulseClasses.join("/")}-class`);
    if (r.caseInfos.length) parts.push(r.caseInfos.join(", "));
    return parts.join(" · ");
  };

  const label = (r: Rocket) => r.name || specSummary(r);

  // Shared styling for the edit/delete segments of a rocket chip.
  const edge = (active: boolean) =>
    active
      ? "border-zinc-900 bg-zinc-900 text-zinc-300 hover:text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-500 dark:hover:text-zinc-900"
      : "border-zinc-300 bg-white text-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:text-zinc-200";

  // "Save current view as a rocket": offered when the current filters describe a
  // single rocket — one diameter (the only requirement), plus class/case lists
  // and an impulse band — that isn't already saved, so a flyer who's dialed in
  // their filters can persist them in one click.
  const numParam = (p: string): number | null => {
    const v = sp.get(p);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  // The "dia" param as a single value (no comma list), or null.
  const curDia = (() => {
    const v = sp.get("dia");
    return v && !v.includes(",") ? v : null;
  })();
  // A multi-value param read as a list (comma-separated), or [] when absent.
  const multiParam = (p: string): string[] => (sp.get(p) ?? "").split(",").filter(Boolean);
  // Two string lists equal as sets (order/dup-insensitive).
  const sameList = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
  const curSpec: RocketInput | null =
    curDia && Number.isFinite(Number(curDia))
      ? {
          diameterMm: Number(curDia),
          impulseClasses: multiParam("class"),
          caseInfos: multiParam("case"),
          minImpulseNs: numParam("imin"),
          maxImpulseNs: numParam("imax"),
        }
      : null;
  const alreadySaved =
    curSpec != null &&
    rockets.some(
      (r) =>
        r.diameterMm === curSpec.diameterMm &&
        sameList(r.impulseClasses, curSpec.impulseClasses ?? []) &&
        sameList(r.caseInfos, curSpec.caseInfos ?? []) &&
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
                  impulseClasses={r.impulseClasses}
                  caseInfos={r.caseInfos}
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
            title="Save the current diameter (+ class/case/impulse) filters as a rocket"
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
  classes,
  cases,
  initial,
  submitLabel,
  onSubmit,
}: {
  diameters: number[];
  classes: string[];
  cases: CaseOption[];
  initial?: Rocket;
  submitLabel: string;
  onSubmit: (spec: {
    name?: string;
    diameterMm: number;
    impulseClasses: string[];
    caseInfos: string[];
    minImpulseNs: number | null;
    maxImpulseNs: number | null;
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [diameter, setDiameter] = useState(
    String(initial?.diameterMm ?? diameters[0]),
  );
  // All narrowings are optional. Diameter is the only required field. Class +
  // case are multi-select (a rocket can fly several classes / own several
  // cases), held as Sets.
  const [impulseClasses, setImpulseClasses] = useState<Set<string>>(
    () => new Set(initial?.impulseClasses ?? []),
  );
  const [caseInfos, setCaseInfos] = useState<Set<string>>(
    () => new Set(initial?.caseInfos ?? []),
  );
  const toggleIn = (set: Set<string>, setSet: (s: Set<string>) => void, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setSet(next);
  };
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
  // use" (diameter null), which spans diameters. Selected cases that don't belong
  // to the current diameter are hidden + excluded on submit (but kept in state,
  // so toggling the diameter back restores them).
  const dnum = Number(diameter);
  const caseChoices = cases.filter((c) => c.diameter == null || c.diameter === dnum);
  const caseActive = new Set([...caseInfos].filter((v) => caseChoices.some((c) => c.value === v)));
  const classOptions: SelectOption[] = classes.map((c) => ({ value: c }));

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
          impulseClasses: [...impulseClasses],
          caseInfos: [...caseActive],
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
      {classes.length > 0 && (
        <div className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            Class <span className="opacity-60">(optional, pick any)</span>
          </span>
          <SearchableMultiSelect
            options={classOptions}
            active={impulseClasses}
            onToggle={(v) => toggleIn(impulseClasses, setImpulseClasses, v)}
            onClear={() => setImpulseClasses(new Set())}
            noun="class"
            nounPlural="classes"
            placeholder="type a class — H, J…"
          />
        </div>
      )}
      {caseChoices.length > 0 && (
        <div className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            Cases <span className="opacity-60">(optional, pick any you own)</span>
          </span>
          <CaseFilter
            options={caseChoices}
            active={caseActive}
            onToggle={(v) => toggleIn(caseInfos, setCaseInfos, v)}
            onClear={() => setCaseInfos(new Set())}
          />
        </div>
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
