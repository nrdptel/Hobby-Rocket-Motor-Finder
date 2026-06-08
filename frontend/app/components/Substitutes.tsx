import {
  formatImpulse,
  formatPrice,
  formatThrust,
  manufacturerLabel,
  safeHref,
} from "@/lib/derive";
import type { Substitute } from "@/lib/derive";
import { PackHint } from "./PackHint";

/** "N similar motors in stock" disclosure shown under a motor that's sold out
 * everywhere. Each entry is a same-mount (diameter), same-cert (impulse class)
 * motor whose impulse/thrust are close enough to fly in its place, with the
 * cheapest in-stock price and a link to buy it. A native <details> — no JS. */
export function Substitutes({ subs }: { subs: Substitute[] | undefined }) {
  if (!subs || subs.length === 0) return null;
  return (
    <details className="mt-1">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">
        <span aria-hidden>↻</span>
        {subs.length} similar {subs.length === 1 ? "motor" : "motors"} in stock
      </summary>
      <ul className="mt-2 space-y-1.5 border-l-2 border-emerald-200 pl-3 dark:border-emerald-900/60">
        {subs.map((s, i) => (
          <li
            key={`${s.designation}-${i}`}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
          >
            <span className="min-w-0">
              <span className="font-mono text-zinc-800 dark:text-zinc-200">{s.designation}</span>
              <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                {manufacturerLabel(s.manufacturer)} · {formatImpulse(s.total_impulse_ns)} ·{" "}
                {formatThrust(s.avg_thrust_n)}
              </span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
              {formatPrice(s.bestPriceCents, s.currency)}
              <PackHint url={s.url} />
              {s.url && (
                <>
                  {" "}
                  <a
                    href={safeHref(s.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-700 underline hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-300"
                  >
                    at {s.vendorName ?? "vendor"} →
                  </a>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
