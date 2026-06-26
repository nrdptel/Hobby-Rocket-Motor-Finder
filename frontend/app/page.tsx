import Link from "next/link";
import {
  type CatalogHistorySummary,
  loadCatalogMotors,
  loadHistoryLog,
  loadHistorySummary,
  loadSnapshot,
} from "@/lib/snapshot";
import { mergedCatalog } from "@/lib/catalogMotors";
import { buildShapeMap, curveKey, loadCurves, sparkPath } from "@/lib/curves";
import { catalogAvailability } from "@/lib/history";
import { observancesForDate } from "@/lib/observances";
import {
  CERT_LEVELS,
  MIN_CLASS,
  caseOptions,
  certKey,
  formatPrice,
  groupUnmatched,
  listingInStock,
  manufacturerLabel,
  propellantOptions,
  safeHref,
  vendorOptions,
} from "@/lib/derive";
import { CatalogFilterProvider } from "./components/CatalogFilters";
import { CatalogView } from "./components/CatalogView";
import { PlanOrderButton } from "./components/PlanOrderButton";
import { HowItWorks } from "./components/HowItWorks";
import { Methodology } from "./components/Methodology";
import { SnapshotTime } from "./components/SnapshotTime";
import { StatusBadge } from "./components/StatusBadge";
import { ApiButton } from "./components/ApiButton";
import { FusionSpaceBadge } from "./components/FusionSpaceBadge";
import { KofiButton } from "./components/KofiButton";
import { ThemeToggle } from "./components/ThemeToggle";

// Fully static — NOT ISR. The snapshot is bundled at build time and only changes
// on the hourly scrape redeploy, so there is nothing to revalidate at runtime;
// `revalidate` only opted the page into ISR, where every redeploy flushes the
// cache and the next request to each region regenerates (a metered ISR *write*) —
// which is what blew up under real traffic. As a plain prerendered page it's
// served from the CDN with no per-request regeneration, refreshed each deploy.
// Same data freshness, no ISR reads/writes. (No `searchParams` read below keeps
// it static; see the note in Home.)

export default async function Home() {
  const [snapshot, history, historyLog, catalog] = await Promise.all([
    loadSnapshot(),
    loadHistorySummary(),
    loadHistoryLog(),
    loadCatalogMotors(),
  ]);
  if (!snapshot) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">HPR Motor Finder</h1>
          <ThemeToggle />
        </div>
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">
          No snapshot yet. Run{" "}
          <code className="font-mono text-xs">
            hpr catalog refresh && hpr scrape run csrocketry && hpr snapshot export
          </code>{" "}
          from the backend, then reload.
        </p>
      </main>
    );
  }

  // The page intentionally does NOT read searchParams: doing so would force a
  // per-request dynamic render of the whole 596-motor catalog. Instead this page
  // is static / ISR (cacheable at the edge), always shipping the full catalog,
  // and the client filter store (CatalogFilterProvider) reads the URL on mount
  // and applies any shared filter. Filtering runs client-side in CatalogView, so
  // changing a filter re-renders the in-memory catalog instantly with no
  // navigation / server round-trip.

  // All motors that have any listing (before filtering).
  // MIN_CLASS hides A/B/C-class Estes-style model rocket motors — this tool
  // is for mid-power and HPR builders.
  // The full catalog universe: every stocked motor (D+, with a listing) PLUS the
  // "phantom" AeroTech/Cesaroni/Loki D+ motors no tracked vendor stocks — so a
  // search for a real motor always lands somewhere honest.
  const motorsWithListings = mergedCatalog(snapshot.motors, catalog, MIN_CLASS);

  // Compact per-motor availability (buyable-% over the reliable-cadence window)
  // for the catalog badges. Computed once server-side from the event log and
  // shipped as one small record per motor — the 1.1MB log never reaches the
  // client.
  const availability = catalogAvailability(motorsWithListings, historyLog, snapshot.generated_at);

  // Per-motor thrust-curve sparkline paths, precomputed server-side and keyed by
  // motor id. Only a tiny path string per motor reaches the client (no raw curve
  // points, no client geometry) so the catalog row can show the burn shape.
  const curveMap = await loadCurves();
  const sparklines: Record<number, string> = {};
  for (const m of motorsWithListings) {
    const pts = curveMap[curveKey(m.manufacturer, m.designation)];
    if (pts) {
      const d = sparkPath(pts);
      if (d) sparklines[m.id] = d;
    }
  }
  // Thrust-curve shape stats (peak / initial thrust + impulse centroid) for the
  // flight-similarity substitute ranking — computed once server-side, shipped as
  // a compact map keyed by manufacturer|designation.
  const shapes = buildShapeMap(curveMap);

  // Available filter options derived from motors-with-listings (so we don't
  // offer pills that yield zero results).
  const manufacturerOptions = Array.from(
    new Set(motorsWithListings.map((m) => manufacturerLabel(m.manufacturer))),
  ).sort();
  // The brand column + filter only matter once more than one manufacturer is
  // present; with AeroTech alone (e.g. the example snapshot) they'd be noise.
  const showManufacturer = manufacturerOptions.length > 1;
  const classOptions = Array.from(
    new Set(motorsWithListings.map((m) => m.impulse_class)),
  ).sort();
  const diameterOptions = Array.from(
    new Set(motorsWithListings.map((m) => m.diameter_mm)),
  ).sort((a, b) => a - b);
  // Reload cases (+ "Single use") present among motors-with-listings, for the
  // searchable case filter. Empty on a snapshot written before case data existed,
  // which hides the Case row entirely.
  const caseFilterOptions = caseOptions(motorsWithListings);
  // Propellants present (searchable, brand-grouped) and vendors present (pills).
  const propellantFilterOptions = propellantOptions(motorsWithListings);
  const vendorFilterOptions = vendorOptions(motorsWithListings);
  // Only offer cert levels that actually have motors with listings — by the
  // motor's REAL required level (so a hot G shows up under L1, not mid-power).
  const presentCertKeys = new Set(motorsWithListings.map((m) => certKey(m)));
  const certOptions = CERT_LEVELS.filter((lvl) => presentCertKeys.has(lvl.key)).map(
    ({ key, label, sublabel }) => ({ key, label, sublabel }),
  );
  // Compact per-motor summary for the "My Rockets" in-stock match counts. Built
  // over all motors-with-listings (not the filtered view) so each rocket's count
  // is absolute, independent of the current filters.
  const rocketMotors = motorsWithListings.map((m) => ({
    diameter_mm: m.diameter_mm,
    impulse_class: m.impulse_class,
    total_impulse_ns: m.total_impulse_ns,
    case_info: m.case_info ?? null,
    motor_type: m.motor_type ?? null,
    inStock: m.listings.some((l) => listingInStock(l.status)),
  }));

  // Filtering, sorting, grouping, substitutes, and the per-listing history lookup
  // now run client-side in CatalogView (instant, no round-trip). The server ships
  // the full motors-with-listings set once, plus a SLIM history summary: only the
  // six fields the catalog reads (restock timing + the price-signal rollup). The
  // five unused fields — status_current, first_seen_at, last_change_at,
  // restock_count, price_current_cents (two of them long ISO timestamps) — are
  // projected out here so they never reach the browser. The detail page loads its
  // own full history server-side, so this doesn't affect it.
  const catalogHistory: CatalogHistorySummary = {};
  for (const url in history) {
    const h = history[url];
    catalogHistory[url] = {
      currently_in_stock: h.currently_in_stock,
      last_in_stock_at: h.last_in_stock_at,
      last_restock_at: h.last_restock_at,
      price_prev_cents: h.price_prev_cents,
      price_low_cents: h.price_low_cents,
      price_high_cents: h.price_high_cents,
    };
  }

  // Drop A/B/C-class entries from the unmatched section too (the same
  // MIN_CLASS gate applied to motors). Also drop AeroTech Q-Jet products —
  // they're a low-power model-rocketry line not in the ThrustCurve subset
  // we pull, and the user doesn't care to see them as "unmatched".
  const unmatched = (snapshot.unmatched ?? []).filter((u) => {
    // Null-guard scraped strings: a malformed snapshot shouldn't crash the page.
    const m = (u.raw_designation ?? "").match(/^([A-O])/i);
    if (m && m[1].toUpperCase() < MIN_CLASS) return false;
    if (/q-?jet/i.test(u.raw_title ?? "")) return false;
    return true;
  });
  // Collapse same-designation listings (e.g. an I297 sold by four vendors) into
  // one grouped entry instead of a row per vendor.
  const unmatchedGroups = groupUnmatched(unmatched);

  // Monthly flourishes (Pride, Men's Mental Health Month, …) shown in the footer.
  const observances = observancesForDate();

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <header className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <div>
          <FusionSpaceBadge className="mb-1.5" />
          <h1 className="text-2xl font-semibold tracking-tight">HPR Motor Finder</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Snapshot generated <SnapshotTime iso={snapshot.generated_at} />
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <PlanOrderButton />
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-2">
            <ApiButton />
            <KofiButton />
          </div>
        </div>
      </header>

      <HowItWorks />

      <Methodology />

      <CatalogFilterProvider>
        <CatalogView
          allMotors={motorsWithListings}
          history={catalogHistory}
          availability={availability}
          generatedAt={snapshot.generated_at}
          showManufacturer={showManufacturer}
          manufacturers={manufacturerOptions}
          classes={classOptions}
          diameters={diameterOptions}
          certLevels={certOptions}
          cases={caseFilterOptions}
          propellants={propellantFilterOptions}
          vendors={vendorFilterOptions}
          rocketMotors={rocketMotors}
          sparklines={sparklines}
          shapes={shapes}
        />
      </CatalogFilterProvider>

      {unmatched.length > 0 && (
        <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-lg font-semibold tracking-tight">Unmatched listings</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Products we found on a vendor site but couldn&apos;t map to a ThrustCurve motor.
            Usually means a new naming pattern we haven&apos;t taught the normalizer yet.
          </p>
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-100 text-left text-xs uppercase tracking-wider text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2">Raw designation</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-900">
                {unmatchedGroups.map((g) =>
                  g.listings.map((u, i) => (
                    <tr key={u.url} className="hover:bg-zinc-100 dark:hover:bg-zinc-900/60">
                      {i === 0 && (
                        <td
                          rowSpan={g.listings.length}
                          className="px-3 py-2 align-top font-mono"
                        >
                          {g.designation}
                        </td>
                      )}
                      <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{u.raw_title}</td>
                      <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{u.vendor_name}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={u.status} count={u.stock_count} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPrice(u.price_cents, u.currency)}
                      </td>
                      <td className="px-3 py-2">
                        <a
                          href={safeHref(u.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                        >
                          view
                        </a>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>

          {/* Stacked counterpart of the unmatched table for narrow screens —
              one card per designation, each vendor listing inside it. */}
          <ul className="mt-4 space-y-2 md:hidden">
            {unmatchedGroups.map((g) => (
              <li
                key={g.listings[0].url}
                className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
              >
                <div className="truncate font-mono text-zinc-800 dark:text-zinc-200">
                  {g.designation}
                </div>
                <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800/80">
                  {g.listings.map((u) => (
                    <li
                      key={u.url}
                      className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">{u.vendor_name}</div>
                        <div className="mt-0.5">
                          <StatusBadge status={u.status} count={u.stock_count} />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="tabular-nums text-zinc-800 dark:text-zinc-200">
                          {formatPrice(u.price_cents, u.currency)}
                        </div>
                        <a
                          href={safeHref(u.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                        >
                          view
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <a
              href="https://github.com/nrdptel/Hobby-Rocket-Motor-Finder"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-current">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Source on GitHub
            </a>
            <span aria-hidden className="text-zinc-300 dark:text-zinc-700">·</span>
            <a
              href="https://www.thrustcurve.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              Motor data from ThrustCurve
            </a>
            <span aria-hidden className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link href="/privacy" className="hover:text-zinc-800 dark:hover:text-zinc-200">
              Privacy
            </Link>
            {process.env.NEXT_PUBLIC_ALERTS_ENABLED === "1" && (
              <>
                <span aria-hidden className="text-zinc-300 dark:text-zinc-700">·</span>
                <Link href="/alerts" className="hover:text-zinc-800 dark:hover:text-zinc-200">
                  Manage email alerts
                </Link>
              </>
            )}
          </nav>

          <a
            href="https://fusionspace.co"
            target="_blank"
            rel="noopener noreferrer"
            title="Fusion Space — free, polished tools for high-power rocketry"
            className="group inline-flex items-center gap-1.5 transition hover:opacity-80"
          >
            <span>A</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/fusion-space-logo.svg"
              alt="Fusion Space"
              width={1694}
              height={378}
              className="h-5 w-auto"
            />
            <span>
              project{" "}
              <span aria-hidden className="opacity-0 transition group-hover:opacity-100">
                ↗
              </span>
            </span>
          </a>
        </div>

        <p className="mt-5 max-w-3xl leading-relaxed text-zinc-500 dark:text-zinc-400">
          Personal, non-commercial project &mdash; not affiliated with any listed vendor or manufacturer.
          Stock and prices are scraped on a schedule from public vendor sites, are a point-in-time
          snapshot, and may be stale by the time you click through; always verify on the vendor&apos;s
          own page before buying.
        </p>

        {observances.length > 0 && (
          <div className="mt-4 space-y-1">
            {observances.map((o) => (
              <p key={o.id} className="text-zinc-500 dark:text-zinc-400">
                <span aria-hidden>{o.emoji}</span> {o.message}
                {o.href && (
                  <>
                    {" "}
                    <a
                      href={o.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
                    >
                      {o.hrefLabel} &rarr;
                    </a>
                  </>
                )}
              </p>
            ))}
          </div>
        )}
      </footer>
    </main>
  );
}
