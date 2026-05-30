import { loadSnapshot, type Motor } from "@/lib/snapshot";
import { StatusBadge } from "./components/StatusBadge";

export const dynamic = "force-dynamic";

function formatPrice(cents: number | null, currency: string): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

// Pull the delay time out of an AeroTech vendor designation.
// Handles both HPR style (H242T-14A -> 14s adj) and low/mid-power (D13-10W -> 10s).
function extractDelay(designation: string): string | null {
  if (!designation) return null;
  // HPR: <class><digits><propellant>-<delay>A?    e.g. H242T-14A
  // LP:  <class><digits>-<delay><propellant>     e.g. D13-10W
  const m = designation.match(/-(\d{1,2})([A-Z]?)/);
  if (!m) return null;
  const seconds = m[1];
  const adjustable = m[2] === "A";
  return adjustable ? `${seconds}s adj` : `${seconds}s`;
}

// Decide what to render in the Delay column. Prefers the listing-specific
// SKU delay (e.g. "D13-4W" -> 4s); falls back to the motor's catalog delay
// metadata (e.g. I280DM -> "6,8,10,12,14 adj").
function delayForRow(rawDesignation: string, motor: Motor): string {
  const fromSku = extractDelay(rawDesignation);
  if (fromSku) return fromSku;
  const d = motor.delays;
  if (!d) return "—";
  if (d === "P") return "plugged";
  // Multi-value lists read better without a trailing 's' (ThrustCurve style).
  // Single values get the 's' suffix to clarify the unit at a glance.
  const isMulti = d.includes(",");
  if (motor.delay_adjustable) {
    return isMulti ? `${d} adj` : `${d}s adj`;
  }
  return isMulti ? `${d}s` : `${d}s`;
}

function rankMotor(m: Motor): [string, number, string] {
  return [m.impulse_class, m.diameter_mm, m.designation];
}

function motorsWithListings(motors: Motor[]): Motor[] {
  return motors
    .filter((m) => m.listings.length > 0)
    .sort((a, b) => {
      const [ac, ad, an] = rankMotor(a);
      const [bc, bd, bn] = rankMotor(b);
      if (ac !== bc) return ac.localeCompare(bc);
      if (ad !== bd) return ad - bd;
      return an.localeCompare(bn);
    });
}

export default async function Home() {
  const snapshot = await loadSnapshot();
  if (!snapshot) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">HPR Motor Finder</h1>
        <p className="mt-4 text-zinc-600">
          No snapshot yet. Run{" "}
          <code className="font-mono text-xs">
            hpr catalog refresh && hpr scrape run csrocketry && hpr snapshot export
          </code>{" "}
          from the backend, then reload.
        </p>
      </main>
    );
  }

  const motors = motorsWithListings(snapshot.motors);
  const total = motors.length;
  const inStockCount = motors.filter((m) =>
    m.listings.some(
      (l) => l.status === "in_stock_with_count" || l.status === "in_stock"
    )
  ).length;
  const unmatched = snapshot.unmatched ?? [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="border-b border-zinc-200 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">HPR Motor Finder</h1>
        <p className="mt-2 text-sm text-zinc-600">
          {total} motors with at least one listing · {inStockCount} with stock somewhere
          {unmatched.length > 0 && <> · {unmatched.length} listings we couldn&apos;t identify</>} ·
          snapshot generated {new Date(snapshot.generated_at + "Z").toLocaleString()}
        </p>
      </header>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2">Motor</th>
              <th className="px-3 py-2" title="The full vendor designation, e.g. D13-10W or H242T-14A — what the vendor actually lists the SKU as.">Variety</th>
              <th className="px-3 py-2">Class</th>
              <th className="px-3 py-2">Dia</th>
              <th className="px-3 py-2">Propellant</th>
              <th className="px-3 py-2">Total Impulse</th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2" title="Ejection-charge delay time. For HPR motors, 'adj' means the delay is drilled to length at the field.">Delay</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {motors.flatMap((m) =>
              m.listings.map((l, i) => (
                <tr key={`${m.id}-${l.vendor_slug}-${i}`} className="hover:bg-zinc-50">
                  <td className="px-3 py-2 font-mono">{i === 0 ? m.designation : ""}</td>
                  <td className="px-3 py-2 font-mono text-zinc-700">{l.raw_designation || "—"}</td>
                  <td className="px-3 py-2">{i === 0 ? m.impulse_class : ""}</td>
                  <td className="px-3 py-2">{i === 0 ? `${m.diameter_mm}mm` : ""}</td>
                  <td className="px-3 py-2">{i === 0 ? m.propellant ?? "—" : ""}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {i === 0
                      ? m.total_impulse_ns != null
                        ? `${m.total_impulse_ns.toFixed(0)} N·s`
                        : "—"
                      : ""}
                  </td>
                  <td className="px-3 py-2 text-zinc-600">{l.vendor_name}</td>
                  <td className="px-3 py-2 tabular-nums">{delayForRow(l.raw_designation, m)}</td>
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
                      className="text-zinc-500 underline hover:text-zinc-900"
                    >
                      view
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {unmatched.length > 0 && (
        <section className="mt-10 border-t border-zinc-200 pt-6">
          <h2 className="text-lg font-semibold tracking-tight">Unmatched listings</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Products we found on a vendor site but couldn&apos;t map to a ThrustCurve motor.
            Usually means a new naming pattern we haven&apos;t taught the normalizer yet.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Raw designation</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {unmatched.map((u, i) => (
                  <tr key={`u-${u.vendor_slug}-${i}`} className="hover:bg-zinc-50">
                    <td className="px-3 py-2 font-mono">{u.raw_designation || "—"}</td>
                    <td className="px-3 py-2 text-zinc-600">{u.raw_title}</td>
                    <td className="px-3 py-2 text-zinc-600">{u.vendor_name}</td>
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
                        className="text-zinc-500 underline hover:text-zinc-900"
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

      <footer className="mt-12 border-t border-zinc-200 pt-4 text-xs text-zinc-500">
        Sources scraped on a schedule from public vendor sites. Stock data is a
        point-in-time snapshot and may be stale by the time you click through —
        always verify on the vendor page before buying.
      </footer>
    </main>
  );
}
