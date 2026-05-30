import type { StockStatus } from "@/lib/snapshot";

const STYLES: Record<StockStatus, string> = {
  in_stock_with_count: "bg-emerald-100 text-emerald-900 border-emerald-300",
  in_stock: "bg-emerald-50 text-emerald-800 border-emerald-200",
  out_of_stock: "bg-zinc-100 text-zinc-600 border-zinc-300",
  special_order: "bg-amber-100 text-amber-900 border-amber-300",
  unknown: "bg-zinc-50 text-zinc-500 border-zinc-200",
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
