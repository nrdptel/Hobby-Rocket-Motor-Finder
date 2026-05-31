import { loadSnapshot, type Listing, type Motor } from "@/lib/snapshot";
import { FilterBar } from "./components/FilterBar";
import { StatusBadge } from "./components/StatusBadge";

export const dynamic = "force-dynamic";

type SearchParamsRaw = Promise<{ [k: string]: string | string[] | undefined }>;

type DelayGroup = {
  delay: string;
  delaySortKey: number;
  variety: string;
  listings: Listing[];
};

type GroupedMotor = Motor & { delayGroups: DelayGroup[] };

function formatPrice(cents: number | null, currency: string): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function extractDelay(designation: string): string | null {
  if (!designation) return null;
  const m = designation.match(/-(\d{1,2})([A-Z]?)/);
  if (!m) return null;
  const seconds = m[1];
  const adjustable = m[2] === "A";
  return adjustable ? `${seconds}s adj` : `${seconds}s`;
}

function delayForRow(rawDesignation: string, motor: Motor): string {
  const fromSku = extractDelay(rawDesignation);
  if (fromSku) return fromSku;
  const d = motor.delays;
  if (!d) return "—";
  if (d === "P") return "plugged";
  const isMulti = d.includes(",");
  if (motor.delay_adjustable) {
    return isMulti ? `${d} adj` : `${d}s adj`;
  }
  return `${d}s`;
}

function rankMotor(m: Motor): [string, number, string] {
  return [m.impulse_class, m.diameter_mm, m.designation];
}

function thrustcurveUrl(m: Motor): string {
  return `https://www.thrustcurve.org/motors/${encodeURIComponent(m.manufacturer)}/${encodeURIComponent(m.designation)}/`;
}

function sortedMotors(motors: Motor[]): Motor[] {
  return [...motors].sort((a, b) => {
    const [ac, ad, an] = rankMotor(a);
    const [bc, bd, bn] = rankMotor(b);
    if (ac !== bc) return ac.localeCompare(bc);
    if (ad !== bd) return ad - bd;
    return an.localeCompare(bn);
  });
}

function parseSetParam(v: string | string[] | undefined): Set<string> {
  if (!v) return new Set();
  const raw = Array.isArray(v) ? v.join(",") : v;
  return new Set(raw.split(",").filter(Boolean));
}

function listingInStock(status: string): boolean {
  return status === "in_stock_with_count" || status === "in_stock";
}

function delaySortKey(delay: string): number {
  if (delay === "—") return Number.POSITIVE_INFINITY;
  if (delay === "plugged") return -1;
  // Take the first numeric value found ("4s" -> 4, "6,8,10,12,14 adj" -> 6).
  const m = delay.match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
}

function groupByDelay(motor: Motor): GroupedMotor {
  const byDelay = new Map<string, DelayGroup>();
  for (const l of motor.listings) {
    const delay = delayForRow(l.raw_designation, motor);
    const existing = byDelay.get(delay);
    if (existing) {
      existing.listings.push(l);
    } else {
      byDelay.set(delay, {
        delay,
        delaySortKey: delaySortKey(delay),
        variety: l.raw_designation || motor.designation,
        listings: [l],
      });
    }
  }
  const delayGroups = Array.from(byDelay.values())
    .map((g) => ({
      ...g,
      // In-stock first, then alphabetical by vendor.
      listings: [...g.listings].sort((a, b) => {
        const ai = listingInStock(a.status) ? 0 : 1;
        const bi = listingInStock(b.status) ? 0 : 1;
        if (ai !== bi) return ai - bi;
        return a.vendor_name.localeCompare(b.vendor_name);
      }),
    }))
    .sort((a, b) => a.delaySortKey - b.delaySortKey);
  return { ...motor, delayGroups };
}

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
  const fClass = parseSetParam(params.class);
  const fDia = parseSetParam(params.dia);
  const fProp = parseSetParam(params.prop);
  const fInStock = params.in_stock === "1";
  const fQueryRaw = Array.isArray(params.q) ? params.q[0] : params.q;
  const fQuery = (fQueryRaw ?? "").trim().toLowerCase();

  // Hide A/B/C-class Estes-style model rocket motors — this tool is for
  // mid-power and HPR builders. D is where the project's primary audience starts.
  const MIN_CLASS = "D";

  // All motors that have any listing (before filtering).
  const motorsWithListings = snapshot.motors.filter(
    (m) => m.listings.length > 0 && m.impulse_class >= MIN_CLASS,
  );

  // Available filter options derived from motors-with-listings (so we don't
  // offer pills that yield zero results).
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
      if (fClass.size > 0 && !fClass.has(m.impulse_class)) return false;
      if (fDia.size > 0 && !fDia.has(String(m.diameter_mm))) return false;
      if (fProp.size > 0 && (!m.propellant || !fProp.has(m.propellant))) return false;
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
    .map(groupByDelay);

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
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="border-b border-zinc-800 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">HPR Motor Finder</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {visible} motors shown · {inStockCount} with stock somewhere
          {unmatched.length > 0 && <> · {unmatched.length} listings we couldn&apos;t identify</>} ·
          snapshot generated {new Date(snapshot.generated_at + "Z").toLocaleString()}
        </p>
      </header>

      <FilterBar
        classes={classOptions}
        diameters={diameterOptions}
        propellants={propellantOptions}
        totalMotors={total}
        visibleMotors={visible}
      />

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Motor</th>
              <th className="px-3 py-2">Class</th>
              <th className="px-3 py-2">Dia</th>
              <th className="px-3 py-2">Propellant</th>
              <th className="px-3 py-2">Total Impulse</th>
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
                <td colSpan={11} className="px-3 py-8 text-center text-sm text-zinc-400">
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
                  for (const l of g.listings) {
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
                              {m.total_impulse_ns != null
                                ? `${m.total_impulse_ns.toFixed(0)} N·s`
                                : "—"}
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
                        <td className="px-3 py-2">
                          <StatusBadge status={l.status} count={l.stock_count} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatPrice(l.price_cents, l.currency)}
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

      {unmatched.length > 0 && (
        <section className="mt-10 border-t border-zinc-800 pt-6">
          <h2 className="text-lg font-semibold tracking-tight">Unmatched listings</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Products we found on a vendor site but couldn&apos;t map to a ThrustCurve motor.
            Usually means a new naming pattern we haven&apos;t taught the normalizer yet.
          </p>
          <div className="mt-4 overflow-x-auto">
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
                {unmatched.map((u, i) => (
                  <tr key={`u-${u.vendor_slug}-${i}`} className="hover:bg-zinc-900/60">
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
