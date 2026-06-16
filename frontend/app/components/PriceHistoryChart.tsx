import type { PriceHistory } from "@/lib/history";

// Plot geometry (SVG user units; scales responsively via viewBox).
const W = 640;
const H = 140;
const PAD_L = 52; // left gutter for the price labels
const PAD_B = 16; // room for the date label

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The motor's cheapest in-stock price over time — one buyer-relevant line
 * (the min across all vendors at each moment), drawn as a step series since
 * price holds flat between observed changes. Pure SVG, server-rendered. Only
 * shown when the price has actually moved (the builder returns null otherwise). */
export function PriceHistoryChart({ history }: { history: PriceHistory }) {
  const { points, lowCents, highCents, currentCents, trackStartMs, nowMs } = history;
  const span = nowMs - trackStartMs;
  if (points.length < 2 || span <= 0 || highCents <= lowCents) return null;

  const plotW = W - PAD_L;
  const plotH = H - PAD_B;
  const pad = (highCents - lowCents) * 0.18 || 1; // breathing room so the line isn't glued to the edges
  const yMin = lowCents - pad;
  const yMax = highCents + pad;
  const x = (t: number) => ((t - trackStartMs) / span) * plotW;
  const y = (c: number) => plotH - ((c - yMin) / (yMax - yMin)) * plotH;

  // Step path: hold each price flat until the next change, then step; extend the
  // last price out to "now".
  const segs: string[] = [`M${x(points[0].tMs).toFixed(1)} ${y(points[0].cents).toFixed(1)}`];
  for (let i = 1; i < points.length; i++) {
    segs.push(`L${x(points[i].tMs).toFixed(1)} ${y(points[i - 1].cents).toFixed(1)}`); // hold
    segs.push(`L${x(points[i].tMs).toFixed(1)} ${y(points[i].cents).toFixed(1)}`); // step
  }
  segs.push(`L${plotW.toFixed(1)} ${y(points[points.length - 1].cents).toFixed(1)}`); // out to now
  const d = segs.join(" ");

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full text-emerald-600 dark:text-emerald-400"
        role="img"
        aria-label={`Cheapest in-stock price over time: low ${usd(lowCents)}, high ${usd(highCents)}${
          currentCents != null ? `, currently ${usd(currentCents)}` : ""
        }.`}
        preserveAspectRatio="none"
      >
        {/* y-axis high/low labels in the left gutter */}
        <text x={PAD_L - 6} y={11} textAnchor="end" className="fill-zinc-500 text-[10px] dark:fill-zinc-400">
          {usd(highCents)}
        </text>
        <text x={PAD_L - 6} y={plotH} textAnchor="end" className="fill-zinc-500 text-[10px] dark:fill-zinc-400">
          {usd(lowCents)}
        </text>
        <g transform={`translate(${PAD_L},0)`}>
          <line x1={0} y1={plotH} x2={plotW} y2={plotH} className="stroke-zinc-300 dark:stroke-zinc-700" strokeWidth={1} />
          <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* start + now date labels under the baseline */}
          <text x={0} y={H - 3} className="fill-zinc-500 text-[10px] dark:fill-zinc-400">
            {shortDate(trackStartMs)}
          </text>
          <text x={plotW} y={H - 3} textAnchor="end" className="fill-zinc-500 text-[10px] dark:fill-zinc-400">
            now
          </text>
        </g>
      </svg>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Cheapest in-stock price across vendors, per motor.
        {currentCents != null && (
          <>
            {" "}Now <span className="font-medium text-zinc-700 dark:text-zinc-300">{usd(currentCents)}</span>
            {currentCents <= lowCents ? " — its lowest tracked." : ` · low ${usd(lowCents)}.`}
          </>
        )}
      </p>
    </div>
  );
}
