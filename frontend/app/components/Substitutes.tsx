import { formatPrice, safeHref } from "@/lib/derive";
import type { Substitute } from "@/lib/derive";
import { PackHint } from "./PackHint";
import { SubstituteLink } from "./SubstituteLink";

/** "N similar motors in stock" disclosure shown under a motor that's sold out
 * everywhere. Each entry is a same-mount (diameter), same-cert (impulse class)
 * motor whose impulse/thrust are close enough to fly in its place, with the
 * cheapest in-stock price and a link to buy it. The designation links to the
 * swap's own detail page — the same {@link SubstituteLink} the detail page's
 * "Similar motors in stock" list uses — so a shopper can vet a suggestion
 * (specs, thrust curve, every vendor) before leaving the site to buy it.
 *
 * A native <details>: with no `open`/`onToggle` it needs no JS at all, and even
 * with them the toggle itself stays native — `open` is an INITIAL value the
 * catalog uses to reopen the disclosure after a Back navigation (which remounts
 * the list and would otherwise collapse it), and `onToggle` only records the
 * change. Neither drives a re-render. See MotorResults / lib/catalogSession. */
export function Substitutes({
  subs,
  open,
  onToggle,
}: {
  subs: Substitute[] | undefined;
  /** Initial open state only — this is not a controlled disclosure. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  if (!subs || subs.length === 0) return null;
  return (
    <details
      className="mt-1"
      open={open}
      onToggle={onToggle && ((e) => onToggle(e.currentTarget.open))}
    >
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">
        <span aria-hidden>↻</span>
        {subs.length} similar {subs.length === 1 ? "motor" : "motors"} in stock
        {subs.length > 1 && (
          <span className="font-normal text-zinc-500 dark:text-zinc-400">
            · closest{" "}
            <span className="font-mono text-zinc-700 dark:text-zinc-300">
              {subs[0].designation}
            </span>
          </span>
        )}
      </summary>
      <ul className="mt-2 space-y-1.5 border-l-2 border-emerald-200 pl-3 dark:border-emerald-900/60">
        {subs.map((s, i) => (
          <li
            key={`${s.designation}-${i}`}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
          >
            <SubstituteLink motor={s} />
            <span className="shrink-0 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
              {formatPrice(s.bestPriceCents, s.currency)}
              <PackHint listing={s} />
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
