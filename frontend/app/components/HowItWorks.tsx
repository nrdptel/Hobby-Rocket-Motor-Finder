import { BestPriceTag } from "./BestPriceTag";
import { StatusBadge } from "./StatusBadge";

/** A collapsed-by-default "How it works" explainer + legend. Native <details>
 * so it needs no client JS, is keyboard-accessible, and stays out of the way for
 * return visitors. Focused on what a flyer can *do* with the site; the badge
 * legend reuses the real components so it always matches the table/cards. The
 * companion "How the data is derived" section at the foot of the page covers the
 * methodology (matching, restock timing, substitute rules). */
export function HowItWorks() {
  const alertsEnabled = process.env.NEXT_PUBLIC_ALERTS_ENABLED === "1";
  return (
    <details className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <summary className="cursor-pointer select-none font-medium text-zinc-700 dark:text-zinc-300">
        How it works
      </summary>

      <div className="mt-3 space-y-4 text-zinc-600 dark:text-zinc-400">
        <p>
          Live{" "}
          <strong className="font-medium text-zinc-800 dark:text-zinc-200">
            AeroTech, Cesaroni &amp; Loki
          </strong>{" "}
          motor stock and pricing, aggregated across 11 U.S. vendors, refreshed on a schedule and
          matched against{" "}
          <a
            href="https://www.thrustcurve.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ThrustCurve
          </a>
          {" "}so you can see who has a given motor in stock without checking every vendor by hand.
        </p>

        <div>
          <p className="font-medium text-zinc-700 dark:text-zinc-300">What you can do</p>
          <ul className="mt-2 space-y-2">
            <li>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">Search &amp; filter</strong>{" "}
              by impulse class, diameter, total-impulse range, certification level (L1&ndash;L3),
              manufacturer, and in-stock-only &mdash; then{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">sort</strong> by class,
              total impulse, thrust, diameter, or price. Your filters live in the URL, so a search is
              shareable and survives a refresh.
            </li>
            <li>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">My Rockets</strong> &mdash;
              save a rocket&apos;s motor mount (diameter + the cert level you fly) and instantly see how
              many in-stock motors fit it; one tap applies it as a filter.
            </li>
            <li>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">★ Star</strong> motors to a
              watchlist kept in this browser, then use the{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">★ Starred</strong> filter to
              show only those.
            </li>
            {alertsEnabled && (
              <li>
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">🔔 Restock alerts</strong>{" "}
                &mdash; get an email when a specific motor, or anything that fits one of your saved
                rockets, comes back in stock. One-click unsubscribe; no account needed.
              </li>
            )}
            <li>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">Similar in stock</strong>{" "}
              &mdash; when a motor is sold out at every vendor, we surface comparable motors that{" "}
              <em>are</em> in stock and would fly in its place. (How a substitute is chosen is explained
              at the foot of the page.)
            </li>
          </ul>
        </div>

        <div>
          <p className="font-medium text-zinc-700 dark:text-zinc-300">Reading a listing</p>
          <ul className="mt-2 space-y-2.5">
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
                next to it means that vendor&apos;s data was carried forward from an earlier scrape &mdash;
                staler than the rest.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="shrink-0 pt-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                restocked
              </span>
              <span>
                A green <strong className="font-medium text-zinc-800 dark:text-zinc-200">restocked</strong>{" "}
                marker flags a listing we just saw come back in stock; a grey{" "}
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">last in stock</strong>{" "}
                note shows when a now-sold-out listing last had any.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="shrink-0 pt-0.5 text-base leading-none text-amber-500 dark:text-amber-400">
                ★
              </span>
              <span>Tap the star by any motor to add it to your watchlist.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="shrink-0 pt-0.5 font-mono text-xs text-zinc-500">SKU</span>
              <span>
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">Variety</strong> and{" "}
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">Delay</strong> are the
                exact vendor designation (e.g. H242T-14A) and its ejection-charge delay &mdash;
                &ldquo;adj&rdquo; means it&apos;s drilled to length at the field. A motor&apos;s
                designation links to its ThrustCurve page.
              </span>
            </li>
          </ul>
        </div>

        <p className="text-xs">
          Stock and prices are scraped best-effort and may be stale by the time you click through &mdash;
          always confirm on the vendor&apos;s own page before buying.
        </p>
      </div>
    </details>
  );
}
