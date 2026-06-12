"use client";

import { useMemo } from "react";

import { buildCatalogView, parseCatalogParams } from "@/lib/catalog";
import type { CaseOption, PropellantOption, SubstituteShape, VendorOption } from "@/lib/derive";
import type { CatalogAvailability } from "@/lib/history";
import { rocketMatchesParams, useRockets, type RocketMotor } from "@/lib/rockets";
import type { CatalogHistorySummary, Motor } from "@/lib/snapshot";
import { useCatalogFilters } from "./CatalogFilters";
import { CompareTray } from "./CompareTray";
import { FilterBar } from "./FilterBar";
import { MotorResults } from "./MotorResults";
import { MyRockets } from "./MyRockets";
import { RocketLoadout } from "./RocketLoadout";

type CertLevel = { key: string; label: string; sublabel: string };

/** The interactive catalog: My Rockets + filter bar + results. Reads the filter
 * state from the client store (CatalogFilterProvider) and runs the SAME pure
 * filter/group pipeline the server used, in memory, so every filter change is
 * instant. The full motors + history set ships once from the server. */
export function CatalogView({
  allMotors,
  history,
  availability,
  generatedAt,
  showManufacturer,
  manufacturers,
  classes,
  diameters,
  certLevels,
  cases,
  propellants,
  vendors,
  rocketMotors,
  sparklines,
  shapes,
}: {
  allMotors: Motor[];
  history: CatalogHistorySummary;
  availability: Record<number, CatalogAvailability>;
  generatedAt: string;
  showManufacturer: boolean;
  manufacturers: string[];
  classes: string[];
  diameters: number[];
  certLevels: CertLevel[];
  cases: CaseOption[];
  propellants: PropellantOption[];
  vendors: VendorOption[];
  rocketMotors: RocketMotor[];
  /** Per-motor thrust-curve sparkline path, keyed by motor id. */
  sparklines: Record<number, string>;
  /** Per-motor thrust-curve shape stats (for substitute ranking), keyed by
   * "manufacturer|designation". */
  shapes: Record<string, SubstituteShape>;
}) {
  const { params } = useCatalogFilters();
  const parsed = useMemo(() => parseCatalogParams((k) => params.get(k) ?? undefined), [params]);
  const { motors, substitutes } = useMemo(
    () => buildCatalogView(allMotors, parsed, shapes),
    [allMotors, parsed, shapes],
  );

  // The "active" rocket — when the current filters exactly describe a saved
  // rocket — drives the loadout ("what can I fly in this airframe right now").
  // Empty during SSR/first paint (rockets are client-only), so it appears after
  // hydration; no flash because the catalog below already shows the same motors.
  const { rockets, hydrated } = useRockets();
  const activeRocket = useMemo(
    () => (hydrated ? rockets.find((r) => rocketMatchesParams(r, (k) => params.get(k))) : undefined),
    [hydrated, rockets, params],
  );

  // Designation labels for every motor, so the compare tray can name any selected
  // id even when the current filters would hide it.
  const compareLabels = useMemo(() => {
    const out: Record<number, string> = {};
    for (const m of allMotors) out[m.id] = m.designation;
    return out;
  }, [allMotors]);

  return (
    <>
      <MyRockets
        diameters={diameters}
        classes={classes}
        cases={cases}
        motors={rocketMotors}
      />

      {activeRocket && (
        <RocketLoadout
          key={activeRocket.id}
          rocket={activeRocket}
          allMotors={allMotors}
          availability={availability}
          showManufacturer={showManufacturer}
        />
      )}

      <FilterBar
        manufacturers={manufacturers}
        classes={classes}
        diameters={diameters}
        certLevels={certLevels}
        cases={cases}
        propellants={propellants}
        vendors={vendors}
      />

      <MotorResults
        motors={motors}
        showManufacturer={showManufacturer}
        generatedAt={generatedAt}
        starredOnly={parsed.starredOnly}
        history={history}
        availability={availability}
        substitutes={substitutes}
        sparklines={sparklines}
      />

      <CompareTray labels={compareLabels} />
    </>
  );
}
