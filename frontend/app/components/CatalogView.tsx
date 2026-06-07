"use client";

import { useMemo } from "react";

import { buildCatalogView, parseCatalogParams } from "@/lib/catalog";
import type { CaseOption, PropellantOption, VendorOption } from "@/lib/derive";
import type { CatalogAvailability } from "@/lib/history";
import type { RocketMotor } from "@/lib/rockets";
import type { HistorySummary, Motor } from "@/lib/snapshot";
import { useCatalogFilters } from "./CatalogFilters";
import { FilterBar } from "./FilterBar";
import { MotorResults } from "./MotorResults";
import { MyRockets } from "./MyRockets";

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
}: {
  allMotors: Motor[];
  history: HistorySummary;
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
}) {
  const { params } = useCatalogFilters();
  const parsed = useMemo(() => parseCatalogParams((k) => params.get(k) ?? undefined), [params]);
  const { motors, substitutes } = useMemo(
    () => buildCatalogView(allMotors, parsed),
    [allMotors, parsed],
  );

  return (
    <>
      <MyRockets
        diameters={diameters}
        certLevels={certLevels}
        classes={classes}
        cases={cases}
        motors={rocketMotors}
      />

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
      />
    </>
  );
}
