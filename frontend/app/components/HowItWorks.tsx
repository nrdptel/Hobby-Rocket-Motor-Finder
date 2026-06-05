import { BestPriceTag } from "./BestPriceTag";
import { StatusBadge } from "./StatusBadge";

/** A collapsed-by-default "How it works" explainer + legend. Native <details>
 * so it needs no client JS, is keyboard-accessible, and stays out of the way for
 * return visitors. The legend reuses the real badge components so it always
 * matches what the table/cards show. */
export function HowItWorks() {
  return (
    <details className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <summary className="cursor-pointer select-none font-medium text-zinc-700 dark:text-zinc-300">
        How it works
      </summary>

      <div className="mt-3 space-y-4 text-zinc-600 dark:text-zinc-400">
        <p>
          Live <strong className="font-medium text-zinc-800 dark:text-zinc-200">AeroTech &amp; Cesaroni</strong>{" "}
          motor stock and pricing, aggregated across 5 U.S. vendors, refreshed on a schedule and
          matched against{" "}
          <a
            href="https://www.thrustcurve.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ThrustCurve
          </a>
          . Use the filters to narrow by impulse class, diameter, total impulse, in-stock, and more.
        </p>

        <ul className="space-y-2.5">
          <li className="flex items-start gap-2.5">
            <span className="shrink-0 pt-0.5">
              <BestPriceTag />
            </span>
            <span>The cheapest in-stock listing for a given variety across vendors.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="shrink-0 pt-0.5">
              <StatusBadge status="in_stock_with_count" count={3} />
            </span>
            <span>
              Stock status. <span className="text-amber-600 dark:text-amber-500/80">2h old</span>{" "}
              next to it means that vendor&apos;s data was carried forward from an earlier scrape —
              staler than the rest.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="shrink-0 pt-0.5 text-base leading-none text-amber-500 dark:text-amber-400">
              ★
            </span>
            <span>
              Save a motor to your watchlist (kept in this browser); the{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">★ Starred</strong>{" "}
              filter then shows only those.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="shrink-0 pt-0.5 font-mono text-xs text-zinc-500">SKU</span>
            <span>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">Variety</strong> and{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">Delay</strong> are the
              exact vendor designation (e.g. H242T-14A) and its ejection-charge delay — &ldquo;adj&rdquo;
              means it&apos;s drilled to length at the field. A motor&apos;s designation links to its
              ThrustCurve page.
            </span>
          </li>
        </ul>

        <p className="text-xs">
          Stock and prices are scraped best-effort and may be stale by the time you click through —
          always confirm on the vendor&apos;s own page before buying.
        </p>
      </div>
    </details>
  );
}
