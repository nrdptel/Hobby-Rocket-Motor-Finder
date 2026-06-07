import { formatAgo, formatWindow, type MotorAvailability, type Segment } from "@/lib/history";

/** Availability history for a single motor: how often it's been buyable since
 * tracking became reliable, plus a per-vendor in-stock/out timeline. Pure
 * render — all the math lives in `lib/history.ts`. A server component (no
 * interactivity), so it adds nothing to the client bundle.
 *
 * Honest-by-construction: the window is clipped to the reliable-cadence epoch
 * and labelled with its real length, and the headline % is withheld until we've
 * tracked a meaningful stretch (so a few hours of data never masquerades as a
 * trend). */
export function AvailabilityHistory({
  availability,
  now,
}: {
  availability: MotorAvailability;
  now: Date;
}) {
  const a = availability;
  const startLabel = new Date(a.trackStartMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const windowLabel = formatWindow(a.windowMs);
  const pct = Math.round(a.fraction * 100);

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold tracking-tight">Availability history</h2>

      {!a.meaningful ? (
        <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
          Tracking started {startLabel}. Availability history is still building —
          check back in a day or two for buyable-over-time stats.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {pct}%
            </span>
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              buyable somewhere over the last {windowLabel}
            </span>
          </div>
          <p className="mt-1 text-sm">
            {a.currentlyInStock ? (
              <span className="font-medium text-emerald-700 dark:text-emerald-400">In stock now</span>
            ) : a.lastBuyableAtMs ? (
              <span className="text-zinc-500 dark:text-zinc-400">
                Out everywhere · last buyable {formatAgo(now.getTime() - a.lastBuyableAtMs)} ago
              </span>
            ) : (
              <span className="text-zinc-500 dark:text-zinc-400">
                Not seen in stock since tracking began
              </span>
            )}
            {a.priceLowCents != null && a.priceHighCents != null && a.priceHighCents > a.priceLowCents ? (
              <span className="text-zinc-500 dark:text-zinc-400">
                {" · "}price ranged ${(a.priceLowCents / 100).toFixed(2)}–$
                {(a.priceHighCents / 100).toFixed(2)}
              </span>
            ) : null}
          </p>

          {/* Motor-level "buyable somewhere" union strip. */}
          <div className="mt-4">
            <TimelineBar segments={a.timeline} label="In stock at any vendor" />
            <div className="mt-1 flex justify-between text-[11px] text-zinc-400 dark:text-zinc-500">
              <span>{startLabel}</span>
              <span>now</span>
            </div>
          </div>

          {/* Per-vendor strips, only when more than one vendor carries it. */}
          {a.vendors.length > 1 && (
            <div className="mt-4 space-y-2">
              {a.vendors.map((v) => (
                <div key={v.vendorSlug} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {v.vendorName}
                  </span>
                  <div className="min-w-0 flex-1">
                    <TimelineBar segments={v.segments} label={`Stock at ${v.vendorName}`} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <Legend className="bg-emerald-500" text="in stock" />
            <Legend className="bg-zinc-300 dark:bg-zinc-700" text="out" />
            <Legend className="bg-zinc-100 dark:bg-zinc-800" text="before tracked" />
            <span>· hourly since {startLabel}</span>
          </div>
        </>
      )}
    </section>
  );
}

const SEG_CLASS: Record<Segment["kind"], string> = {
  in: "bg-emerald-500",
  out: "bg-zinc-300 dark:bg-zinc-700",
  unknown: "bg-zinc-100 dark:bg-zinc-800",
};

function TimelineBar({ segments, label }: { segments: Segment[]; label: string }) {
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
      role="img"
      aria-label={label}
      title={label}
    >
      {segments.map((s, i) => (
        <div
          key={i}
          className={SEG_CLASS[s.kind]}
          style={{ flexGrow: s.widthFrac, flexBasis: 0 }}
        />
      ))}
    </div>
  );
}

function Legend({ className, text }: { className: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${className}`} />
      {text}
    </span>
  );
}
