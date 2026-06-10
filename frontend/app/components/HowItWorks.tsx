import { BestPriceTag } from "./BestPriceTag";
import { CartIcon } from "./CartIcon";
import { CertBadge } from "./CertBadge";
import { DiscontinuedBadge } from "./DiscontinuedBadge";
import { StatusBadge } from "./StatusBadge";

/** Collapsed-by-default site guide + listing legend (the visible label is "Using
 * this site"; the component keeps its original name to avoid churn). Native
 * <details> so it needs no client JS, is keyboard-accessible, and stays out of
 * the way for return visitors. Focused on what a flyer can *do* and how to read a
 * row; the badge legend reuses the real components so it always matches the
 * table/cards. The companion "How the data is derived" section directly below
 * covers the methodology (matching, restock timing, substitute rules). */
export function HowItWorks() {
  const alertsEnabled = process.env.NEXT_PUBLIC_ALERTS_ENABLED === "1";
  return (
    <details className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <summary className="cursor-pointer select-none font-medium text-zinc-700 dark:text-zinc-300">
        Using this site
      </summary>

      <div className="mt-3 space-y-4 text-zinc-600 dark:text-zinc-400">
        <p>
          Live{" "}
          <strong className="font-medium text-zinc-800 dark:text-zinc-200">
            AeroTech, Cesaroni &amp; Loki
          </strong>{" "}
          motor stock and pricing, aggregated across the major U.S. vendors, refreshed on a schedule
          and matched against{" "}
          <a
            href="https://www.thrustcurve.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ThrustCurve
          </a>
          {" "}&mdash; so you can see who has a given motor in stock without checking every vendor by hand.
        </p>

        <div>
          <p className="font-medium text-zinc-700 dark:text-zinc-300">What you can do</p>
          <ul className="mt-2 space-y-2">
            <li>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">Search</strong>{" "}
              by typing a designation, common name, or the exact vendor variety (e.g.{" "}
              <span className="font-mono text-xs">H242T-14A</span>).
            </li>
            <li>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">Filter</strong>{" "}
              by impulse class, diameter, total-impulse range, certification level (L1&ndash;L3),
              manufacturer, vendor, propellant, reload case, in-stock-only, and ★ starred-only &mdash;
              then{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">sort</strong>{" "}
              by class, total impulse, thrust, diameter, or cheapest in-stock price (either direction).
              Filtering is instant (it happens in your browser), and every filter lives in the URL, so
              any view is shareable and survives a refresh. The list covers the <em>whole</em>{" "}
              AeroTech/Cesaroni/Loki D+ catalog &mdash; motors no tracked vendor stocks appear too,
              clearly marked &ldquo;not sold by any tracked vendor,&rdquo; with the closest in-stock
              swap, so a search never dead-ends.
            </li>
            <li>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">Open a motor</strong>{" "}
              &mdash; click its designation for a detail page with the full specs, every vendor&apos;s
              price and stock side by side, an <strong className="font-medium text-zinc-800 dark:text-zinc-200">availability
              history</strong> (how often it&apos;s been buyable, with a per-vendor stock timeline),
              similar in-stock motors, and a link to its ThrustCurve thrust curve.
            </li>
            <li>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">My Rockets</strong>{" "}
              &mdash; save a rocket by its motor-mount diameter (the only required field) and optionally
              pin the cert level you fly, an impulse class, a reload case, and/or a total-impulse band.
              Each rocket shows how many in-stock motors fit it, and a tap opens a{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">&ldquo;fly it&rdquo;</strong>{" "}
              loadout: the in-stock motors that fit, cheapest first, with one tap to add them all to a
              Plan order &mdash; and when nothing that fits is in stock, the closest buyable swaps. You
              can also save your current filtered view as a rocket.
            </li>
            <li>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">★ Star</strong>{" "}
              motors to a watchlist kept in this browser &mdash; use the{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">★ Starred</strong>{" "}filter
              to show only those, and as the basis for planning an order (below).
            </li>
            <li>
              <strong className="inline-flex items-center gap-1 font-medium text-zinc-800 dark:text-zinc-200">
                <CartIcon className="h-3.5 w-3.5" />
                Plan your order
              </strong>{" "}
              &mdash; once you&apos;ve starred a few motors, a <em>Plan order</em>{" "}button appears next to
              ★ Starred. It finds the cheapest way to buy your whole list across vendors: set a quantity
              per motor and your estimated shipping/HAZMAT cost per order, and it trades motor price
              against the number of shipments (since each shipment is its own HAZMAT fee). It&apos;s
              pack-aware &mdash; where a motor is sold only in a multipack, it buys whole packs and
              prices per motor. If any motor on your list is sold out everywhere, it suggests in-stock
              swaps you can add in one tap to keep the order buyable. Share the plan as a link or copy
              it as plain text for an email.
            </li>
            {alertsEnabled && (
              <li>
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">Restock reminders</strong>{" "}
                &mdash; tap the bell on any motor to get an email when it&apos;s back in stock, or set one on a
                saved rocket to be told when <em>anything</em>{" "}that fits it restocks. Double
                opt-in, one-click unsubscribe, manage anytime &mdash; no account needed.
              </li>
            )}
            <li>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">Similar in stock</strong>{" "}
              &mdash; when a motor is sold out at every vendor, we surface comparable motors that{" "}
              <em>are</em>{" "}in stock and would fly in its place. (How a substitute is chosen is explained
              at the foot of the page.)
            </li>
            <li>
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">Dark / light theme</strong>{" "}
              &mdash; toggle at the top-right; your choice is remembered on this device.
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
                Stock status; the number is the vendor&apos;s on-hand count when they publish one.{" "}
                <span className="text-amber-600 dark:text-amber-500/80">Xh old</span>{" "}next to it means
                that vendor&apos;s data was carried forward from an earlier scrape &mdash; staler than the rest.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="shrink-0 pt-0.5">
                <StatusBadge status="special_order" count={null} leadTime="16–20 weeks" />
              </span>
              <span>
                A backorder source (e.g. AeroTech-direct) that doesn&apos;t hold stock &mdash; shown with its
                published fulfillment lead time rather than as &ldquo;in stock.&rdquo;
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
              <span className="shrink-0 pt-0.5">
                <span className="rounded border border-amber-400/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:border-amber-500/50 dark:text-amber-500">
                  rarely in stock
                </span>
              </span>
              <span>
                Availability from history:{" "}
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">rarely in stock</strong>{" "}
                means it&apos;s in stock right now but usually isn&apos;t &mdash; grab it;{" "}
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">often out</strong>{" "}
                means it comes and goes. Reliably-stocked motors show neither.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="shrink-0 pt-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                ↓ lowest tracked
              </span>
              <span>
                How a price compares to its own history:{" "}
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">↓ lowest tracked</strong> /{" "}
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">↓ price dropped</strong>{" "}
                (green) flag a good time to buy;{" "}
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">↑ above its low</strong>{" "}
                means it&apos;s been cheaper before.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="shrink-0 pt-0.5">
                <CertBadge impulseClass="J" />
              </span>
              <span>
                The HPR certification level a motor needs (L1 = H&ndash;I, L2 = J&ndash;L, L3 = M&ndash;O);
                it doubles as the cert filter.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="shrink-0 pt-0.5">
                <DiscontinuedBadge discontinued />
              </span>
              <span>Old stock of an out-of-production motor &mdash; it won&apos;t be restocked once it sells out.</span>
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
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">Variety</strong>{" "}and{" "}
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">Delay</strong>{" "}are the
                exact vendor designation (e.g. H242T-14A) and its ejection-charge delay &mdash;
                &ldquo;adj&rdquo; means it&apos;s drilled to length at the field. A motor&apos;s
                designation links to its detail page.
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
