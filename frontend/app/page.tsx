import Link from "next/link";
import { loadHistorySummary, loadSnapshot } from "@/lib/snapshot";
import type { HistorySummary } from "@/lib/snapshot";
import {
  CERT_LEVELS,
  MIN_CLASS,
  caseKey,
  caseOptions,
  certClasses,
  findSubstitutes,
  formatPrice,
  groupByDelay,
  listingInStock,
  manufacturerLabel,
  motorInStock,
  parseDir,
  parseOrder,
  parseSetParam,
  propellantOptions,
  safeHref,
  sortedMotors,
  toSubstitute,
  vendorOptions,
} from "@/lib/derive";
import type { Substitute } from "@/lib/derive";
import { FilterBar } from "./components/FilterBar";
import { MyRockets } from "./components/MyRockets";
import { HowItWorks } from "./components/HowItWorks";
import { Methodology } from "./components/Methodology";
import { MotorResults } from "./components/MotorResults";
import { SnapshotTime } from "./components/SnapshotTime";
import { StatusBadge } from "./components/StatusBadge";
import { ThemeToggle } from "./components/ThemeToggle";

// Snapshot refreshes on a scrape cadence (typically every few hours), so
// per-request SSR is wasted work. Revalidate cached HTML every 60s — same
// freshness ceiling as our scrape, ~50× less server work under load.
export const revalidate = 60;

type SearchParamsRaw = Promise<{ [k: string]: string | string[] | undefined }>;

export default async function Home({ searchParams }: { searchParams: SearchParamsRaw }) {
  const [snapshot, history] = await Promise.all([loadSnapshot(), loadHistorySummary()]);
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

  const params = await searchParams;
  const fMfr = parseSetParam(params.mfr);
  const fClass = parseSetParam(params.class);
  const fDia = parseSetParam(params.dia);
  const fCertClasses = certClasses(parseSetParam(params.cert));
  const fCase = parseSetParam(params.case);
  const fProp = parseSetParam(params.prop);
  const fVendor = parseSetParam(params.vendor);
  const fInStock = params.in_stock === "1";
  const fSort = params.sort === "price" ? "price" : "stock";
  const fOrder = parseOrder(params.order);
  const fDir = parseDir(params.dir);
  const fStarredOnly = params.starred === "1";
  const fQueryRaw = Array.isArray(params.q) ? params.q[0] : params.q;
  const fQuery = (fQueryRaw ?? "").trim().toLowerCase();
  // Total-impulse bounds (N·s). Non-numeric/absent params leave the bound open.
  const parseNum = (v: string | string[] | undefined): number | null => {
    const raw = Array.isArray(v) ? v[0] : v;
    const n = raw != null && raw.trim() !== "" ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const fMinImpulse = parseNum(params.imin);
  const fMaxImpulse = parseNum(params.imax);

  // All motors that have any listing (before filtering).
  // MIN_CLASS hides A/B/C-class Estes-style model rocket motors — this tool
  // is for mid-power and HPR builders.
  const motorsWithListings = snapshot.motors.filter(
    (m) => m.listings.length > 0 && m.impulse_class >= MIN_CLASS,
  );

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
  // Only offer cert levels that actually have motors with listings.
  const presentClasses = new Set(motorsWithListings.map((m) => m.impulse_class));
  const certOptions = CERT_LEVELS.filter((lvl) =>
    lvl.classes.some((c) => presentClasses.has(c)),
  ).map(({ key, label, sublabel }) => ({ key, label, sublabel }));
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

  // Apply filters, then order by the user's chosen sort.
  const filtered = sortedMotors(
    motorsWithListings.filter((m) => {
      if (fMfr.size > 0 && !fMfr.has(manufacturerLabel(m.manufacturer))) return false;
      if (fClass.size > 0 && !fClass.has(m.impulse_class)) return false;
      if (fCertClasses.size > 0 && !fCertClasses.has(m.impulse_class)) return false;
      if (fDia.size > 0 && !fDia.has(String(m.diameter_mm))) return false;
      if (fCase.size > 0) {
        const k = caseKey(m);
        if (k == null || !fCase.has(k)) return false;
      }
      if (fProp.size > 0 && !(m.propellant && fProp.has(m.propellant))) return false;
      if (fVendor.size > 0 && !m.listings.some((l) => fVendor.has(l.vendor_slug))) return false;
      if (fMinImpulse != null && (m.total_impulse_ns == null || m.total_impulse_ns < fMinImpulse))
        return false;
      if (fMaxImpulse != null && (m.total_impulse_ns == null || m.total_impulse_ns > fMaxImpulse))
        return false;
      if (fInStock && !m.listings.some((l) => listingInStock(l.status))) return false;
      if (fQuery) {
        const designationHit = m.designation.toLowerCase().includes(fQuery);
        const commonHit = (m.common_name ?? "").toLowerCase().includes(fQuery);
        const varietyHit = m.listings.some((l) =>
          (l.raw_designation ?? "").toLowerCase().includes(fQuery)
        );
        if (!designationHit && !commonHit && !varietyHit) return false;
      }
      return true;
    }),
    fOrder,
    fDir,
  );

  // For the in-stock toggle: also visually hide the OOS listing rows when active,
  // so each motor only shows the listings that match.
  const filteredWithListings = filtered
    .map((m) =>
      fInStock
        ? { ...m, listings: m.listings.filter((l) => listingInStock(l.status)) }
        : m,
    )
    .map((m) => groupByDelay(m, fSort));

  // History is looked up per listing by URL inside the (client) results
  // component, so only the rendered motors' listings need it. Ship just those
  // entries instead of the whole summary — this keeps the server→client payload
  // proportional to what's shown, not the full catalog (which grows with every
  // manufacturer added).
  const visibleHistory: HistorySummary = {};
  for (const m of filteredWithListings) {
    for (const g of m.delayGroups) {
      for (const l of g.listings) {
        const h = history[l.url];
        if (h) visibleHistory[l.url] = h;
      }
    }
  }

  // For each visible motor that's sold out everywhere, the best in-stock swaps
  // (same diameter + impulse class, close total impulse/thrust). Computed against
  // the full motor set — not the filtered view — so a usable swap isn't hidden by
  // the active filters, then capped at 4 and projected to a compact payload so the
  // server→client size stays proportional to what's shown (mirrors visibleHistory).
  // This is O(sold-out × catalog), but the catalog is small and bounded (~hundreds;
  // manufacturers locked, vendors exhausted) and the page is cached (revalidate=60),
  // so a linear scan per target is cheaper than maintaining a diameter/class index.
  const substitutes: Record<number, Substitute[]> = {};
  for (const m of filteredWithListings) {
    if (motorInStock(m)) continue;
    const subs = findSubstitutes(m, motorsWithListings).slice(0, 4).map(toSubstitute);
    if (subs.length > 0) substitutes[m.id] = subs;
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

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <header className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">HPR Motor Finder</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {unmatched.length > 0 && (
              <>{unmatched.length} listings we couldn&apos;t identify · </>
            )}
            snapshot generated <SnapshotTime iso={snapshot.generated_at} />
          </p>
        </div>
        <ThemeToggle />
      </header>

      <HowItWorks />

      <Methodology />

      <MyRockets
        diameters={diameterOptions}
        certLevels={certOptions}
        classes={classOptions}
        cases={caseFilterOptions}
        motors={rocketMotors}
      />

      <FilterBar
        manufacturers={manufacturerOptions}
        classes={classOptions}
        diameters={diameterOptions}
        certLevels={certOptions}
        cases={caseFilterOptions}
        propellants={propellantFilterOptions}
        vendors={vendorFilterOptions}
      />

      <MotorResults
        motors={filteredWithListings}
        showManufacturer={showManufacturer}
        generatedAt={snapshot.generated_at}
        starredOnly={fStarredOnly}
        history={visibleHistory}
        substitutes={substitutes}
      />

      {unmatched.length > 0 && (
        <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-lg font-semibold tracking-tight">Unmatched listings</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Products we found on a vendor site but couldn&apos;t map to a ThrustCurve motor.
            Usually means a new naming pattern we haven&apos;t taught the normalizer yet.
          </p>
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-100 text-left text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
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
                {unmatched.map((u) => (
                  <tr key={u.url} className="hover:bg-zinc-100 dark:hover:bg-zinc-900/60">
                    <td className="px-3 py-2 font-mono">{u.raw_designation || "—"}</td>
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
                ))}
              </tbody>
            </table>
          </div>

          {/* Stacked counterpart of the unmatched table for narrow screens. */}
          <ul className="mt-4 space-y-2 md:hidden">
            {unmatched.map((u) => (
              <li
                key={u.url}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-zinc-800 dark:text-zinc-200">
                    {u.raw_designation || u.raw_title}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{u.vendor_name}</span>
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
        </section>
      )}

      <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
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

          <div className="flex items-center gap-1.5 opacity-80">
            <span>Built by</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/fusion-space-logo.svg"
              alt="Fusion Space"
              width={1694}
              height={378}
              className="h-5 w-auto"
            />
          </div>
        </div>

        <p className="mt-5 max-w-3xl leading-relaxed text-zinc-400 dark:text-zinc-500">
          Personal, non-commercial project &mdash; not affiliated with any listed vendor or manufacturer.
          Stock and prices are scraped on a schedule from public vendor sites, are a point-in-time
          snapshot, and may be stale by the time you click through; always verify on the vendor&apos;s
          own page before buying.
          {new Date().getMonth() === 5 && (
            <span className="ml-1">🏳️‍🌈 Happy Pride Month &mdash; fly high. 🚀</span>
          )}
        </p>
      </footer>
    </main>
  );
}
