import { loadSnapshot } from "@/lib/snapshot";
import {
  MIN_CLASS,
  formatPrice,
  groupByDelay,
  listingInStock,
  manufacturerLabel,
  parseSetParam,
  sortedMotors,
} from "@/lib/derive";
import { FilterBar } from "./components/FilterBar";
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
  const snapshot = await loadSnapshot();
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
  const fInStock = params.in_stock === "1";
  const fSort = params.sort === "price" ? "price" : "stock";
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

  // Apply filters.
  const filtered = sortedMotors(
    motorsWithListings.filter((m) => {
      if (fMfr.size > 0 && !fMfr.has(manufacturerLabel(m.manufacturer))) return false;
      if (fClass.size > 0 && !fClass.has(m.impulse_class)) return false;
      if (fDia.size > 0 && !fDia.has(String(m.diameter_mm))) return false;
      if (fMinImpulse != null && (m.total_impulse_ns == null || m.total_impulse_ns < fMinImpulse))
        return false;
      if (fMaxImpulse != null && (m.total_impulse_ns == null || m.total_impulse_ns > fMaxImpulse))
        return false;
      if (fInStock && !m.listings.some((l) => listingInStock(l.status))) return false;
      if (fQuery) {
        const designationHit = m.designation.toLowerCase().includes(fQuery);
        const commonHit = (m.common_name ?? "").toLowerCase().includes(fQuery);
        const varietyHit = m.listings.some((l) =>
          l.raw_designation.toLowerCase().includes(fQuery)
        );
        if (!designationHit && !commonHit && !varietyHit) return false;
      }
      return true;
    }),
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

  // Drop A/B/C-class entries from the unmatched section too (the same
  // MIN_CLASS gate applied to motors). Also drop AeroTech Q-Jet products —
  // they're a low-power model-rocketry line not in the ThrustCurve subset
  // we pull, and the user doesn't care to see them as "unmatched".
  const unmatched = (snapshot.unmatched ?? []).filter((u) => {
    const m = u.raw_designation.match(/^([A-O])/i);
    if (m && m[1].toUpperCase() < MIN_CLASS) return false;
    if (/q-?jet/i.test(u.raw_title)) return false;
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

      <FilterBar
        manufacturers={manufacturerOptions}
        classes={classOptions}
        diameters={diameterOptions}
      />

      <MotorResults
        motors={filteredWithListings}
        showManufacturer={showManufacturer}
        generatedAt={snapshot.generated_at}
        starredOnly={fStarredOnly}
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
                        href={u.url}
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
                    href={u.url}
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

      <footer className="mt-12 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800">
        <p>
          Sources scraped on a schedule from public vendor sites. Stock data is a
          point-in-time snapshot and may be stale by the time you click through &mdash;
          always verify on the vendor page before buying.
          {new Date().getMonth() === 5 && (
            <span className="ml-1">🏳️‍🌈 Happy Pride Month — fly high. 🚀</span>
          )}
        </p>
        <div className="mt-3 flex items-center gap-1.5">
          <span>Built by</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/fusion-space-logo.svg"
            alt="Fusion Space"
            width={1694}
            height={378}
            className="h-5 w-auto opacity-80"
          />
        </div>
      </footer>
    </main>
  );
}
