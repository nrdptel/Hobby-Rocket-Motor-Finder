import { SUBSTITUTE_IMPULSE_BAND, SUBSTITUTE_THRUST_BAND } from "@/lib/derive";

const impulsePct = Math.round(SUBSTITUTE_IMPULSE_BAND * 100);
const thrustPct = Math.round(SUBSTITUTE_THRUST_BAND * 100);

/** "How the data is derived" — the methodology companion to How-it-works, parked
 * at the foot of the page. Explains where each number comes from and the rules
 * behind the derived signals (matching, restock timing, best price, and the
 * substitute criteria), so nothing on the page is a black box. The substitute
 * percentages are read from the same constants the matcher uses, so this copy
 * can never drift from the actual behavior. Native <details>, no client JS. */
export function Methodology() {
  return (
    <details className="mt-10 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <summary className="cursor-pointer select-none font-medium text-zinc-700 dark:text-zinc-300">
        How the data is derived
      </summary>

      <div className="mt-3 space-y-4 text-zinc-600 dark:text-zinc-400">
        <p>
          Every figure here is computed from public data &mdash; nothing is hand-entered. This is what
          sits behind each number.
        </p>

        <dl className="space-y-3">
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Stock &amp; price</dt>
            <dd className="mt-0.5">
              Scraped on a schedule from each vendor&apos;s own public pages and matched to a canonical{" "}
              <a
                href="https://www.thrustcurve.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                ThrustCurve
              </a>{" "}
              motor by normalizing the vendor&apos;s product title (e.g. a listing of{" "}
              <span className="font-mono text-xs">D13-10W</span>{" "}resolves to the catalog&apos;s{" "}
              <span className="font-mono text-xs">D13W</span>). It is a point-in-time snapshot; an{" "}
              <span className="text-amber-600 dark:text-amber-500/80">Xh old</span>{" "}note means a
              vendor was briefly unreachable and we carried its last-known data forward.
            </dd>
          </div>

          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Best price</dt>
            <dd className="mt-0.5">
              The lowest price among the <em>in-stock</em>{" "}listings of the same variety (same
              designation and delay) &mdash; not across different delays, which can be genuinely
              different products.
            </dd>
          </div>

          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Restock &amp; last-in-stock</dt>
            <dd className="mt-0.5">
              Derived by comparing successive snapshots. &ldquo;Restocked Xh ago&rdquo; marks a listing
              we actually observed go from out-of-stock back to in-stock; &ldquo;last in stock Xd
              ago&rdquo; is when a now-sold-out listing last had any. A motor&apos;s first appearance is
              never counted as a restock.
            </dd>
          </div>

          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Restock reminders</dt>
            <dd className="mt-0.5">
              After each scrape we diff the new stock against the previous one. When a listing flips
              from out-of-stock back to in-stock, anyone who set a 🔔 reminder on that motor &mdash; or
              on a saved rocket the motor fits (matching diameter, cert level, and impulse band) &mdash;
              gets a single email. Subscriptions are confirmed by a double opt-in and the only data
              stored is your email; every alert has one-click unsubscribe.
            </dd>
          </div>

          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Similar motors in stock</dt>
            <dd className="mt-0.5">
              When a motor is sold out at every vendor, we suggest in-stock motors that could fly in its
              place. A candidate qualifies only when it shares the{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">same diameter</strong>{" "}
              (it has to fit the same motor mount) and the{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">same impulse class</strong>{" "}
              (so the certification you already hold covers it), and its{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">
                total impulse is within &plusmn;{impulsePct}%
              </strong>{" "}
              and{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">
                average thrust within &plusmn;{thrustPct}%
              </strong>{" "}
              of the original, so the flight is comparable &mdash; a gentle long-burn motor is never
              offered as a stand-in for a punchy one even when their total impulse matches. Results are
              ranked by closest fit, then by cheapest in-stock price. If nothing clears that bar, no
              suggestion is shown rather than a poor one.
            </dd>
          </div>

          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Certification level</dt>
            <dd className="mt-0.5">
              Derived from a motor&apos;s impulse class via the NAR/Tripoli ladder &mdash; L1 covers
              H&ndash;I, L2 covers J&ndash;L, L3 covers M&ndash;O (D&ndash;G need no HPR cert). It powers
              both the cert filter and the per-motor badge, so you can narrow to exactly what you&apos;re
              rated to fly.
            </dd>
          </div>

          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Special order &amp; lead time</dt>
            <dd className="mt-0.5">
              Some sources (e.g. AeroTech-direct) backorder rather than hold stock, so their listings
              show as <em>special order</em>{" "}with the fulfillment lead time published on their site,
              rather than as &ldquo;in stock.&rdquo;
            </dd>
          </div>

          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Discontinued</dt>
            <dd className="mt-0.5">
              Matched to an out-of-production motor in ThrustCurve &mdash; old stock a vendor is clearing
              that won&apos;t be restocked once it sells out.
            </dd>
          </div>

          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Unmatched listings</dt>
            <dd className="mt-0.5">
              Products we found on a vendor site but couldn&apos;t confidently map to a ThrustCurve motor
              &mdash; usually a naming pattern we haven&apos;t taught the matcher yet, or a motor
              ThrustCurve doesn&apos;t carry. Out-of-scope lines (e.g. low-power Q-Jet) are dropped, not
              shown as unidentified.
            </dd>
          </div>
        </dl>

        <p className="text-xs">
          Stock and price data are best-effort, often stale, and not authoritative &mdash; always
          confirm on the vendor&apos;s own page before purchasing.
        </p>
      </div>
    </details>
  );
}
