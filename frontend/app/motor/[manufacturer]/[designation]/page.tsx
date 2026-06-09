import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  loadCatalogMotors,
  loadHistoryLog,
  loadHistorySummary,
  loadSnapshot,
} from "@/lib/snapshot";
import type { Motor, Snapshot } from "@/lib/snapshot";
import { curveKey, loadCurves } from "@/lib/curves";
import { mergedCatalog } from "@/lib/catalogMotors";
import { buildMotorAvailability } from "@/lib/history";
import {
  MIN_CLASS,
  bestInStockPriceCents,
  buildMotorJsonLd,
  cheapestInStockCents,
  cheapestInStockListing,
  designationFromSlug,
  designationToSlug,
  burnCharacter,
  BURN_LABEL,
  findSubstitutes,
  formatBurn,
  formatImpulse,
  formatIsp,
  formatPrice,
  formatThrust,
  groupByDelay,
  specificImpulseS,
  isBestInStockPrice,
  listingInStock,
  manufacturerLabel,
  manufacturerSlug,
  motorPath,
  safeHref,
  thrustcurveUrl,
} from "@/lib/derive";
import { unitPriceCents } from "@/lib/pack";
import { priceSignal } from "@/lib/priceSignal";
import { AvailabilityHistory } from "@/app/components/AvailabilityHistory";
import { BestPriceTag } from "@/app/components/BestPriceTag";
import { PackHint } from "@/app/components/PackHint";
import { PackNote } from "@/app/components/PackNote";
import { PriceSignalTag } from "@/app/components/PriceSignalTag";
import { CertBadge } from "@/app/components/CertBadge";
import { DiscontinuedBadge } from "@/app/components/DiscontinuedBadge";
import { SparkyBadge } from "@/app/components/SparkyBadge";
import { ThrustCurveChart, type CurveSeries } from "@/app/components/ThrustCurveChart";
import { NotifyButton } from "@/app/components/NotifyButton";
import { RestockBadge } from "@/app/components/RestockBadge";
import { SnapshotTime } from "@/app/components/SnapshotTime";
import { SiteHeader } from "@/app/components/SiteHeader";
import { StaleBadge } from "@/app/components/StaleBadge";
import { StarButton } from "@/app/components/StarButton";
import { StatusBadge } from "@/app/components/StatusBadge";

// Match the catalog: the snapshot refreshes hourly, so re-render at most once a
// minute. New motors (not in generateStaticParams at build) render on demand.
export const revalidate = 60;

type Params = { manufacturer: string; designation: string };

// Resolve the motor for a set of route params. Params arrive URL-decoded from
// Next; the designation slug maps "~"→"/" (a few AeroTech designations contain a
// slash). Routable motors mirror the catalog's universe: every stocked motor AND
// every D+ "phantom" (in the catalog, stocked nowhere) — so a search for a real
// motor always resolves to a page, even an honest "not sold anywhere" one.
async function findMotor(p: Params): Promise<{ motor: Motor; snapshot: Snapshot } | null> {
  const [snapshot, catalog] = await Promise.all([loadSnapshot(), loadCatalogMotors()]);
  if (!snapshot) return null;
  const mfr = p.manufacturer.toLowerCase();
  const designation = designationFromSlug(p.designation);
  const motor = mergedCatalog(snapshot.motors, catalog, MIN_CLASS).find(
    (m) => manufacturerSlug(m.manufacturer) === mfr && m.designation === designation,
  );
  return motor ? { motor, snapshot } : null;
}

export async function generateStaticParams(): Promise<Params[]> {
  const [snapshot, catalog] = await Promise.all([loadSnapshot(), loadCatalogMotors()]);
  if (!snapshot) return [];
  return mergedCatalog(snapshot.motors, catalog, MIN_CLASS)
    .map((m) => ({
      manufacturer: manufacturerSlug(m.manufacturer),
      designation: designationToSlug(m.designation),
    }));
}

function stockSummary(motor: Motor): string {
  const vendors = motor.listings.length;
  if (vendors === 0) return "Not sold by any tracked vendor";
  const inStock = motor.listings.filter((l) => listingInStock(l.status)).length;
  const vendorWord = vendors === 1 ? "vendor" : "vendors";
  if (inStock === 0) return `Sold out at all ${vendors} tracked ${vendorWord}`;
  const cheapest = cheapestInStockListing(motor);
  const price =
    cheapest?.price_cents != null
      ? `, from ${formatPrice(unitPriceCents(cheapest.price_cents, cheapest.url), cheapest.currency)}`
      : "";
  return `In stock at ${inStock} of ${vendors} ${vendorWord}${price}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const found = await findMotor(await params);
  if (!found) return { title: "Motor not found — HPR Motor Finder" };
  const { motor } = found;
  const name = `${manufacturerLabel(motor.manufacturer)} ${motor.designation}`;
  const title = `${name} — ${motor.diameter_mm}mm ${motor.impulse_class}, ${formatImpulse(
    motor.total_impulse_ns,
  )}`;
  const specs = `${motor.impulse_class}-class · ${motor.diameter_mm}mm · ${formatImpulse(
    motor.total_impulse_ns,
  )}${motor.propellant ? ` · ${motor.propellant}` : ""}`;
  const description = `${name}: ${specs}. ${stockSummary(
    motor,
  )}. Live availability + pricing across U.S. high-power rocketry vendors, with a restock alert.`;
  const url = motorPath(motor);
  const ogTitle = `${name} — availability & pricing`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "article", title: ogTitle, description, url },
    twitter: { card: "summary_large_image", title: ogTitle, description },
  };
}

const cellHead =
  "px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400";

export default async function MotorDetailPage({ params }: { params: Promise<Params> }) {
  const found = await findMotor(await params);
  if (!found) notFound();
  const { motor, snapshot } = found;
  const now = new Date(snapshot.generated_at);

  const history = await loadHistorySummary();
  // Per-listing event log, sliced to just this motor's vendors → availability
  // history. Loaded only here (it's the big file); falls back to null when no
  // log is present (fresh clone / pre-backfill deploy).
  const availability = buildMotorAvailability(
    motor.listings,
    await loadHistoryLog(),
    snapshot.generated_at,
  );
  const grouped = groupByDelay(motor, "price"); // cheapest vendor first within a delay
  const inStock = motor.listings.filter((l) => listingInStock(l.status)).length;
  const soldOut = inStock === 0;

  // Same-mount, same-cert in-stock alternatives — useful on a detail page whether
  // or not this motor is in stock. Cross-linked to their own detail pages.
  const similar = findSubstitutes(motor, snapshot.motors).slice(0, 6);

  // Thrust curve(s): this motor's, plus — when it's sold out — an overlay of its
  // top in-stock substitutes, so the burn *shape* of a swap is comparable, not
  // just its headline numbers. Curves come from the static sidecar, joined by
  // manufacturer|designation; missing curves are simply skipped.
  const curveMap = await loadCurves();
  const targetCurve = curveMap[curveKey(motor.manufacturer, motor.designation)];
  const curveSeries: CurveSeries[] = [];
  if (targetCurve) {
    curveSeries.push({ label: motor.designation, points: targetCurve, emphasis: true });
    if (soldOut) {
      for (const s of similar.slice(0, 3)) {
        const pts = curveMap[curveKey(s.manufacturer, s.designation)];
        if (pts) curveSeries.push({ label: s.designation, points: pts });
      }
    }
  }

  const name = `${manufacturerLabel(motor.manufacturer)} ${motor.designation}`;
  const caseLabel = motor.case_info
    ? motor.case_info
    : motor.motor_type === "SU"
      ? "Single use"
      : null;

  const isp = specificImpulseS(motor);
  const burn = burnCharacter(motor);
  const specs: { label: string; value: string }[] = [
    { label: "Impulse class", value: motor.impulse_class },
    { label: "Diameter", value: `${motor.diameter_mm} mm` },
    { label: "Total impulse", value: formatImpulse(motor.total_impulse_ns) },
    { label: "Avg thrust", value: formatThrust(motor.avg_thrust_n) },
    { label: "Burn time", value: formatBurn(motor.burn_time_s) },
    ...(burn ? [{ label: "Burn character", value: BURN_LABEL[burn] }] : []),
    ...(isp != null ? [{ label: "Specific impulse", value: formatIsp(isp) }] : []),
    { label: "Propellant", value: motor.propellant ?? "—" },
    {
      label: "Delays",
      value: motor.delays
        ? `${motor.delays}${motor.delay_adjustable ? " (adjustable)" : ""}`
        : motor.delay_adjustable
          ? "adjustable"
          : "—",
    },
    ...(caseLabel ? [{ label: "Case / type", value: caseLabel }] : []),
    ...(motor.common_name && motor.common_name !== motor.designation
      ? [{ label: "Common name", value: motor.common_name }]
      : []),
  ];

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://motor.fusionspace.co";
  const jsonLd = buildMotorJsonLd(motor, `${siteUrl}${motorPath(motor)}`);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-10">
      {/* Product/Offer structured data for search engines. Escape "<" so a
          scraped vendor name/URL containing "</script>" can't break out. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <SiteHeader />
      <nav className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
        <Link href="/" className="hover:text-zinc-800 dark:hover:text-zinc-200">
          ← All motors
        </Link>
      </nav>

      <header className="mt-4 border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <StarButton motorId={motor.id} designation={motor.designation} />
          <NotifyButton manufacturer={motor.manufacturer} designation={motor.designation} />
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {motor.designation}
          </h1>
          <CertBadge impulseClass={motor.impulse_class} />
          {motor.listings.length > 0 && <DiscontinuedBadge discontinued={motor.discontinued} />}
          <SparkyBadge sparky={motor.sparky} />
        </div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          {manufacturerLabel(motor.manufacturer)} · {motor.impulse_class}-class · {motor.diameter_mm}mm
          {motor.propellant ? ` · ${motor.propellant}` : ""}
          {caseLabel ? ` · ${caseLabel}` : ""}
        </p>
        <p
          className={`mt-1 text-sm font-medium ${
            soldOut
              ? "text-zinc-500 dark:text-zinc-400"
              : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {stockSummary(motor)}
        </p>
      </header>

      {/* Specs */}
      <section className="mt-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {specs.map((s) => (
            <div key={s.label}>
              <dt className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {s.label}
              </dt>
              <dd className="mt-0.5 tabular-nums text-zinc-900 dark:text-zinc-100">{s.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm">
          <a
            href={thrustcurveUrl(motor)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
          >
            View thrust curve on ThrustCurve.org →
          </a>
        </p>
      </section>

      {targetCurve && (
        <section className="mt-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Thrust curve{curveSeries.length > 1 ? " — vs. in-stock substitutes" : ""}
          </h2>
          <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <ThrustCurveChart series={curveSeries} />
          </div>
        </section>
      )}

      {/* Vendor availability — or, for a phantom, an honest "nobody stocks it". */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">Availability by vendor</h2>
        {motor.listings.length === 0 ? (
          <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
            <strong className="font-medium text-zinc-800 dark:text-zinc-200">
              Not sold by any tracked vendor.
            </strong>{" "}
            This is a real {manufacturerLabel(motor.manufacturer)} motor in the ThrustCurve catalog,
            but none of the vendors we watch list it
            {motor.discontinued ? " (it's out of production)" : ""}. If you need it now, the closest
            in-stock motors are below.
          </p>
        ) : (
        <div className="mt-3 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-100 dark:bg-zinc-900">
              <tr>
                <th scope="col" className={cellHead}>Variety</th>
                <th scope="col" className={cellHead}>Delay</th>
                <th scope="col" className={cellHead}>Vendor</th>
                <th scope="col" className={cellHead}>Status</th>
                <th scope="col" className={`${cellHead} text-right`}>Price</th>
                <th scope="col" className={cellHead}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {grouped.delayGroups.map((g) => {
                const bestCents = bestInStockPriceCents(g.listings);
                return g.listings.map((l, i) => {
                  const isBestPrice = isBestInStockPrice(l, bestCents);
                  const sig = priceSignal(history[l.url], l.price_cents, listingInStock(l.status));
                  return (
                    <tr
                      key={`${g.delay}-${l.vendor_slug}-${i}`}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                    >
                      {i === 0 && (
                        <>
                          <td
                            rowSpan={g.listings.length}
                            className="px-3 py-2 align-top font-mono text-zinc-600 dark:text-zinc-300"
                          >
                            {g.variety || "—"}
                          </td>
                          <td
                            rowSpan={g.listings.length}
                            className="px-3 py-2 align-top tabular-nums"
                          >
                            {g.delay}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{l.vendor_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <StatusBadge status={l.status} count={l.stock_count} leadTime={l.lead_time} />
                        <RestockBadge history={history[l.url]} now={now} />
                        <StaleBadge seenAt={l.seen_at} now={now} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {isBestPrice && <BestPriceTag />}
                        <span
                          className={
                            isBestPrice ? "font-medium text-emerald-600 dark:text-emerald-400" : ""
                          }
                        >
                          {formatPrice(unitPriceCents(l.price_cents, l.url), l.currency)}
                        </span>
                        <PackNote priceCents={l.price_cents} currency={l.currency} url={l.url} />
                        {sig && <PriceSignalTag signal={sig} />}
                      </td>
                      <td className="px-3 py-2">
                        <a
                          href={safeHref(l.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                        >
                          view
                        </a>
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
        )}
      </section>

      {/* Availability over time — buyable-% + per-vendor stock timeline. */}
      {availability && <AvailabilityHistory availability={availability} />}

      {/* Similar in-stock motors */}
      {similar.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight">
            {soldOut ? "Similar motors in stock" : "Similar motors"}
          </h2>
          <ul className="mt-3 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {similar.map((s) => {
              // Per-motor (pack-aware) cheapest — works for a single-vendor
              // substitute too (bestInStockPriceCents needs 2+ to compare).
              const cheapestL = cheapestInStockListing(s);
              const price = cheapestInStockCents(s);
              const cur = cheapestL?.currency ?? "USD";
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2"
                >
                  <Link
                    href={motorPath(s)}
                    className="min-w-0 hover:underline"
                  >
                    <span className="font-mono text-zinc-900 dark:text-zinc-100">{s.designation}</span>
                    <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {manufacturerLabel(s.manufacturer)} · {formatImpulse(s.total_impulse_ns)} ·{" "}
                      {formatThrust(s.avg_thrust_n)}
                    </span>
                  </Link>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
                    {formatPrice(price, cur)}
                    <PackHint url={cheapestL?.url} />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <footer className="mt-10 border-t border-zinc-200 pt-5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Snapshot generated <SnapshotTime iso={snapshot.generated_at} /> ·{" "}
        <Link href="/" className="underline hover:text-zinc-700 dark:hover:text-zinc-300">
          back to all motors
        </Link>
      </footer>
    </main>
  );
}
