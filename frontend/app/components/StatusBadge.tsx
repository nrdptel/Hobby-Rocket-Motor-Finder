import type { StockStatus } from "@/lib/snapshot";

const STYLES: Record<StockStatus, string> = {
  in_stock_with_count:
    "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-700/60",
  in_stock:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/60",
  out_of_stock:
    "bg-zinc-100 text-zinc-500 border-zinc-300 dark:bg-zinc-900 dark:text-zinc-500 dark:border-zinc-700",
  special_order:
    "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700/60",
  unknown:
    "bg-zinc-100 text-zinc-500 border-zinc-300 dark:bg-zinc-900 dark:text-zinc-500 dark:border-zinc-800",
};

const LABELS: Record<StockStatus, string> = {
  in_stock_with_count: "in stock",
  in_stock: "in stock",
  out_of_stock: "out of stock",
  special_order: "special order",
  unknown: "unknown",
};

export function StatusBadge({
  status,
  count,
}: {
  status: StockStatus;
  count: number | null;
}) {
  const label = status === "in_stock_with_count" && count != null ? `${count} in stock` : LABELS[status];
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {label}
    </span>
  );
}
