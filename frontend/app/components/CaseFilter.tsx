"use client";

import { useMemo } from "react";
import { SINGLE_USE_CASE } from "@/lib/derive";
import type { CaseOption } from "@/lib/derive";
import { SearchableMultiSelect, type SelectOption } from "./SearchableMultiSelect";

/** Reload-case filter: a searchable multi-select grouped by motor diameter (with
 * "Single use" last), each case tagged with its brand. Thin wrapper that maps
 * CaseOptions onto the generic SearchableMultiSelect. */
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
  // CaseOptions arrive sorted by diameter then value (Single use last), so the
  // first-seen group order is already correct.
  const selectOptions: SelectOption[] = useMemo(
    () =>
      options.map((o) => ({
        value: o.value,
        group: o.diameter == null ? SINGLE_USE_CASE : `${o.diameter}mm`,
        sublabel: o.manufacturer,
      })),
    [options],
  );

  return (
    <SearchableMultiSelect
      options={selectOptions}
      active={active}
      onToggle={onToggle}
      onClear={onClear}
      noun="case"
      placeholder="type a case — 38/720, pro38…"
      mono
    />
  );
}
