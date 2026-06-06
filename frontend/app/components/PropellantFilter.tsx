"use client";

import { useMemo } from "react";
import type { PropellantOption } from "@/lib/derive";
import { SearchableMultiSelect, type SelectOption } from "./SearchableMultiSelect";

/** Propellant filter: a searchable multi-select grouped by brand (AeroTech /
 * Cesaroni / Loki / Other). Thin wrapper that maps PropellantOptions onto the
 * generic SearchableMultiSelect. */
export function PropellantFilter({
  options,
  active,
  onToggle,
  onClear,
}: {
  options: PropellantOption[];
  active: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  // PropellantOptions arrive sorted by brand then name, so the first-seen group
  // order is already correct (AeroTech → Cesaroni → Loki → Other).
  const selectOptions: SelectOption[] = useMemo(
    () => options.map((o) => ({ value: o.value, group: o.brand, sublabel: null })),
    [options],
  );

  return (
    <SearchableMultiSelect
      options={selectOptions}
      active={active}
      onToggle={onToggle}
      onClear={onClear}
      noun="propellant"
      placeholder="type a propellant — blue, redline…"
    />
  );
}
