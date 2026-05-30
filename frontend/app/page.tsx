import { loadSnapshot, type Motor } from "@/lib/snapshot";
import { StatusBadge } from "./components/StatusBadge";

export const dynamic = "force-dynamic";

function formatPrice(cents: number | null, currency: string): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
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

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="border-b border-zinc-200 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">HPR Motor Finder</h1>
        <p className="mt-2 text-sm text-zinc-600">
          {total} motors with at least one listing · {inStockCount} with stock somewhere · snapshot generated{" "}
          {new Date(snapshot.generated_at + "Z").toLocaleString()}
        </p>
      </header>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2">Motor</th>
              <th className="px-3 py-2">Class</th>
              <th className="px-3 py-2">Dia</th>
              <th className="px-3 py-2">Propellant</th>
              <th className="px-3 py-2">Total Impulse</th>
              <th className="px-3 py-2">Vendor</th>
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

      <footer className="mt-12 border-t border-zinc-200 pt-4 text-xs text-zinc-500">
        Sources scraped on a schedule from public vendor sites. Stock data is a
        point-in-time snapshot and may be stale by the time you click through —
        always verify on the vendor page before buying.
      </footer>
    </main>
  );
}
