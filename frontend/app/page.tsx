import { loadSnapshot } from "@/lib/snapshot";
import {
  MIN_CLASS,
  bestInStockPriceCents,
  formatBurn,
  formatImpulse,
  formatPrice,
  formatThrust,
  groupByDelay,
  isBestInStockPrice,
  listingInStock,
  manufacturerLabel,
  parseSetParam,
  sortedMotors,
  thrustcurveUrl,
} from "@/lib/derive";
import { BestPriceTag } from "./components/BestPriceTag";
import { FilterBar } from "./components/FilterBar";
import { MotorCard } from "./components/MotorCard";
import { StaleBadge } from "./components/StaleBadge";
import { StatusBadge } from "./components/StatusBadge";

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
        <h1 className="text-2xl font-semibold tracking-tight">HPR Motor Finder</h1>
        <p className="mt-4 text-zinc-400">
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
  const fProp = parseSetParam(params.prop);
  const fInStock = params.in_stock === "1";
  const fSort = params.sort === "price" ? "price" : "stock";
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
  const propellantOptions = Array.from(
    new Set(motorsWithListings.map((m) => m.propellant).filter((p): p is string => !!p)),
  ).sort();

  // Apply filters.
  const filtered = sortedMotors(
    motorsWithListings.filter((m) => {
      if (fMfr.size > 0 && !fMfr.has(manufacturerLabel(m.manufacturer))) return false;
      if (fClass.size > 0 && !fClass.has(m.impulse_class)) return false;
      if (fDia.size > 0 && !fDia.has(String(m.diameter_mm))) return false;
      if (fProp.size > 0 && (!m.propellant || !fProp.has(m.propellant))) return false;
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

  // Reference point for staleness labels: the moment this snapshot was
  // assembled, NOT wall-clock now. The whole snapshot ages together, so what's
  // worth flagging is a listing that's old *relative to the rest of the run* —
  // i.e. a vendor whose data was carried forward from an earlier scrape.
  const snapshotTime = new Date(snapshot.generated_at);

  const total = motorsWithListings.length;
  const visible = filteredWithListings.length;
  const inStockCount = filteredWithListings.filter((m) =>
    m.listings.some((l) => listingInStock(l.status)),
  ).length;
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
      <header className="border-b border-zinc-800 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">HPR Motor Finder</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {visible} motors shown · {inStockCount} with stock somewhere
          {unmatched.length > 0 && <> · {unmatched.length} listings we couldn&apos;t identify</>} ·
          snapshot generated {new Date(snapshot.generated_at).toLocaleString()}
        </p>
      </header>

      <FilterBar
        manufacturers={manufacturerOptions}
        classes={classOptions}
        diameters={diameterOptions}
        propellants={propellantOptions}
        totalMotors={total}
        visibleMotors={visible}
      />

      <div className="mt-6 hidden overflow-x-auto md:block">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Motor</th>
              {showManufacturer && <th className="px-3 py-2">Mfr</th>}
              <th className="px-3 py-2">Class</th>
              <th className="px-3 py-2">Dia</th>
              <th className="px-3 py-2">Propellant</th>
              <th className="px-3 py-2">Total Impulse</th>
              <th className="px-3 py-2" title="Average thrust and burn time from the ThrustCurve catalog — useful for matching a motor to a thrust-to-weight target.">
                Thrust / Burn
              </th>
              <th className="px-3 py-2" title="The full vendor designation, e.g. D13-10W or H242T-14A — what the vendor actually lists the SKU as.">
                Variety
              </th>
              <th className="px-3 py-2" title="Ejection-charge delay time. For HPR motors, 'adj' means the delay is drilled to length at the field.">
                Delay
              </th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filteredWithListings.length === 0 ? (
              <tr>
                <td colSpan={showManufacturer ? 13 : 12} className="px-3 py-8 text-center text-sm text-zinc-400">
                  No motors match the current filters.
                </td>
              </tr>
            ) : (
              filteredWithListings.flatMap((m) => {
                const motorTotal = m.delayGroups.reduce(
                  (s, g) => s + g.listings.length,
                  0,
                );
                const rows: React.ReactNode[] = [];
                let motorIdx = 0;
                for (const g of m.delayGroups) {
                  let delayIdx = 0;
                  const bestCents = bestInStockPriceCents(g.listings);
                  for (const l of g.listings) {
                    const isBestPrice = isBestInStockPrice(l, bestCents);
                    const isMotorFirst = motorIdx === 0;
                    const isDelayFirst = delayIdx === 0;
                    const isLastInMotor = motorIdx === motorTotal - 1;
                    const trBase =
                      "hover:bg-zinc-900/60 " +
                      (isMotorFirst
                        ? "border-t-2 border-zinc-700 "
                        : isDelayFirst
                          ? "border-t border-zinc-800 "
                          : "");
                    rows.push(
                      <tr
                        key={`${m.id}-${g.delay}-${l.vendor_slug}-${delayIdx}`}
                        className={
                          trBase + (isLastInMotor ? "border-b-2 border-zinc-700" : "")
                        }
                      >
                        {isMotorFirst && (
                          <>
                            <td
                              rowSpan={motorTotal}
                              className="px-3 py-2 font-mono align-top"
                            >
                              <a
                                href={thrustcurveUrl(m)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-zinc-100 underline decoration-zinc-700 underline-offset-2 hover:decoration-zinc-300"
                                title={`View ${m.designation} on ThrustCurve.org`}
                              >
                                {m.designation}
                              </a>
                            </td>
                            {showManufacturer && (
                              <td
                                rowSpan={motorTotal}
                                className="px-3 py-2 align-top text-zinc-400 whitespace-nowrap"
                              >
                                {manufacturerLabel(m.manufacturer)}
                              </td>
                            )}
                            <td rowSpan={motorTotal} className="px-3 py-2 align-top">
                              {m.impulse_class}
                            </td>
                            <td rowSpan={motorTotal} className="px-3 py-2 align-top">
                              {`${m.diameter_mm}mm`}
                            </td>
                            <td rowSpan={motorTotal} className="px-3 py-2 align-top">
                              {m.propellant ?? "—"}
                            </td>
                            <td
                              rowSpan={motorTotal}
                              className="px-3 py-2 tabular-nums align-top"
                            >
                              {formatImpulse(m.total_impulse_ns)}
                            </td>
                            <td
                              rowSpan={motorTotal}
                              className="px-3 py-2 tabular-nums align-top whitespace-nowrap"
                            >
                              <span className="text-zinc-200">{formatThrust(m.avg_thrust_n)}</span>
                              <span className="text-zinc-500"> · {formatBurn(m.burn_time_s)}</span>
                            </td>
                          </>
                        )}
                        {isDelayFirst && (
                          <>
                            <td
                              rowSpan={g.listings.length}
                              className="px-3 py-2 font-mono text-zinc-300 align-top"
                            >
                              {g.variety || "—"}
                            </td>
                            <td
                              rowSpan={g.listings.length}
                              className="px-3 py-2 tabular-nums align-top"
                            >
                              {g.delay}
                            </td>
                          </>
                        )}
                        <td className="px-3 py-2 text-zinc-400">{l.vendor_name}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <StatusBadge status={l.status} count={l.stock_count} />
                          <StaleBadge seenAt={l.seen_at} now={snapshotTime} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {isBestPrice && <BestPriceTag />}
                          <span className={isBestPrice ? "font-medium text-emerald-400" : ""}>
                            {formatPrice(l.price_cents, l.currency)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <a
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-400 underline hover:text-zinc-100"
                          >
                            view
                          </a>
                        </td>
                      </tr>,
                    );
                    delayIdx++;
                    motorIdx++;
                  }
                }
                return rows;
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: the 13-column table only horizontal-scrolls, so render
          a stacked card per motor instead below the md breakpoint. */}
      <div className="mt-6 space-y-3 md:hidden">
        {filteredWithListings.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-8 text-center text-sm text-zinc-400">
            No motors match the current filters.
          </p>
        ) : (
          filteredWithListings.map((m) => (
            <MotorCard
              key={m.id}
              motor={m}
              showManufacturer={showManufacturer}
              snapshotTime={snapshotTime}
            />
          ))
        )}
      </div>

      {unmatched.length > 0 && (
        <section className="mt-10 border-t border-zinc-800 pt-6">
          <h2 className="text-lg font-semibold tracking-tight">Unmatched listings</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Products we found on a vendor site but couldn&apos;t map to a ThrustCurve motor.
            Usually means a new naming pattern we haven&apos;t taught the normalizer yet.
          </p>
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-zinc-800 text-sm">
              <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
                <tr>
                  <th className="px-3 py-2">Raw designation</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {unmatched.map((u) => (
                  <tr key={u.url} className="hover:bg-zinc-900/60">
                    <td className="px-3 py-2 font-mono">{u.raw_designation || "—"}</td>
                    <td className="px-3 py-2 text-zinc-400">{u.raw_title}</td>
                    <td className="px-3 py-2 text-zinc-400">{u.vendor_name}</td>
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
                        className="text-zinc-400 underline hover:text-zinc-100"
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
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-zinc-200">
                    {u.raw_designation || u.raw_title}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{u.vendor_name}</span>
                    <StatusBadge status={u.status} count={u.stock_count} />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular-nums text-zinc-200">
                    {formatPrice(u.price_cents, u.currency)}
                  </div>
                  <a
                    href={u.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-400 underline hover:text-zinc-100"
                  >
                    view
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-12 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
        Sources scraped on a schedule from public vendor sites. Stock data is a
        point-in-time snapshot and may be stale by the time you click through &mdash;
        always verify on the vendor page before buying.
      </footer>
    </main>
  );
}
