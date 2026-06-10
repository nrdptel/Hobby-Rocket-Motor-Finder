import { BURN_LONG_MIN_S, BURN_PUNCHY_MAX_S, SUBSTITUTE_IMPULSE_BAND } from "@/lib/derive";

const impulsePct = Math.round(SUBSTITUTE_IMPULSE_BAND * 100);

/** "How the data is derived" — the methodology companion shown directly below
 * How-it-works. Explains where each number comes from and the rules behind the
 * derived signals (matching, restock timing, best price, and the substitute
 * criteria), so nothing on the page is a black box. The substitute percentages
 * are read from the same constants the matcher uses, so this copy can never
 * drift from the actual behavior. Native <details>, no client JS. */
export function Methodology() {
  const alertsEnabled = process.env.NEXT_PUBLIC_ALERTS_ENABLED === "1";
  return (
    <details className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
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
              <span className="text-amber-700 dark:text-amber-500">Xh old</span>{" "}note means a
              vendor was briefly unreachable and we carried its last-known data forward.
            </dd>
          </div>

          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Best price</dt>
            <dd className="mt-0.5">
              The lowest price among the <em>in-stock</em>{" "}listings of the same variety (same
              designation and delay) &mdash; not across different delays, which can be genuinely
              different products. Multipacks (some vendors sell small motors in 2/3/12-packs) are
              compared and shown <em>per motor</em>, with the pack total noted, so a pack&apos;s real
              per-unit price isn&apos;t mistaken for a single.
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

          {alertsEnabled && (
            <div>
              <dt className="font-medium text-zinc-800 dark:text-zinc-200">Restock reminders</dt>
              <dd className="mt-0.5">
                After each scrape we diff the new stock against the previous one. When a listing flips
                from out-of-stock back to in-stock, anyone who set a reminder on that motor &mdash; or
                on a saved rocket the motor fits (matching diameter, cert level, and impulse band) &mdash;
                gets a single email. Subscriptions are confirmed by a double opt-in and the only data
                stored is your email; every alert has one-click unsubscribe.
              </dd>
            </div>
          )}

          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Similar motors in stock</dt>
            <dd className="mt-0.5">
              When a motor is sold out at every vendor, we suggest in-stock motors that would fly its
              airframe similarly. A candidate must share the{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">same diameter</strong>{" "}
              (it has to fit the same motor mount), the{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">same impulse class</strong>{" "}
              (so the certification you already hold covers it), and{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">
                total impulse within &plusmn;{impulsePct}%
              </strong>{" "}
              of the original (total impulse is the main altitude driver). Then we rank by how similarly
              it&apos;ll <em>fly</em> &mdash; comparing the actual{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">thrust-curve shape</strong>{" "}
              (a gentle long-burn is never offered for a punchy motor even when total impulse matches),
              peak thrust, and liftoff thrust &mdash; and we drop swaps that would be{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">too weak off the rail</strong>{" "}
              (a safety/stability issue) or dramatically punchier. Ties break to the cheapest in-stock
              price. If nothing clears the bar, no suggestion is shown rather than a poor one.
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
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Burn character, sparky &amp; specific impulse</dt>
            <dd className="mt-0.5">
              From ThrustCurve&apos;s catalog data.{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">Burn character</strong>{" "}
              is the burn duration bucketed into{" "}
              <em>punchy</em>{" "}(under {BURN_PUNCHY_MAX_S}s, a hard fast kick),{" "}
              <em>long burn</em>{" "}({BURN_LONG_MIN_S}s or more, a slow lofting push), or{" "}
              <em>standard</em>{" "}in between.{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">Sparky</strong>{" "}
              flags metal-additive propellants that throw gold sparks (great at night, and often
              restricted under fire bans).{" "}
              <strong className="font-medium text-zinc-800 dark:text-zinc-200">Specific impulse</strong>{" "}
              (Isp, in seconds) is total impulse &divide; (propellant weight &times; g) &mdash; a
              propellant-efficiency figure; we hide it when the underlying grain weight looks wrong
              rather than print a number we don&apos;t trust.
            </dd>
          </div>

          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Thrust curve</dt>
            <dd className="mt-0.5">
              The time/thrust trace on a motor&apos;s detail page is the measured curve from{" "}
              <a
                href="https://www.thrustcurve.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                ThrustCurve
              </a>{" "}
              &mdash; we pick the most authoritative one available (certification data over
              manufacturer over user-submitted). When the motor is sold out, its curve is overlaid
              with its in-stock substitutes&apos;, so you can compare the burn <em>shape</em>, not
              just the headline numbers.
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
