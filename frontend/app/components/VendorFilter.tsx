"use client";

import { useMemo } from "react";
import type { VendorOption } from "@/lib/derive";
import { SearchableMultiSelect, type SelectOption } from "./SearchableMultiSelect";

/** Vendor filter: a searchable, flat (ungrouped) multi-select. The URL stores the
 * stable vendor slug while the user sees the display name. Thin wrapper over the
 * generic SearchableMultiSelect. */
export function VendorFilter({
  options,
  active,
  onToggle,
  onClear,
}: {
  options: VendorOption[];
  active: Set<string>;
  onToggle: (slug: string) => void;
  onClear: () => void;
}) {
  // VendorOptions arrive sorted by display name. value = slug (URL param),
  // label = name (what the user reads).
  const selectOptions: SelectOption[] = useMemo(
    () => options.map((o) => ({ value: o.slug, label: o.name })),
    [options],
  );

  return (
    <SearchableMultiSelect
      options={selectOptions}
      active={active}
      onToggle={onToggle}
      onClear={onClear}
      noun="vendor"
      placeholder="type a vendor — wildman, sirius…"
    />
  );
}
