import { curveExtent, curvePath, type ThrustCurve } from "@/lib/curves";

export type CurveSeries = {
  label: string;
  points: ThrustCurve;
  /** The focus motor — drawn solid + heavier, on top. Overlays are thinner. */
  emphasis?: boolean;
};

// Plot geometry (SVG user units; the chart scales responsively via viewBox).
const W = 640;
const H = 220;
const PAD_L = 40; // left gutter so the y-max (peak-thrust) label sits beside the
// plot, never under the curve
const PAD_B = 16; // room for the x-axis baseline + time label

// Distinct, theme-legible colors for overlay (substitute) curves.
const OVERLAY_COLORS = ["#0ea5e9", "#f59e0b", "#a855f7", "#ef4444"];

function peakThrust(points: ThrustCurve): number {
  return points.reduce((m, [, f]) => (f > m ? f : m), 0);
}

function burnTime(points: ThrustCurve): number {
  return points.length ? points[points.length - 1][0] : 0;
}

/** A line chart of one or more motors' thrust curves, drawn to a shared scale so
 * an overlay (e.g. a sold-out motor vs. its in-stock substitutes) is directly
 * comparable. Pure SVG, server-rendered — no client JS. */
export function ThrustCurveChart({
  series,
  className,
}: {
  series: CurveSeries[];
  className?: string;
}) {
  const usable = series.filter((s) => s.points.length >= 2);
  if (usable.length === 0) return null;
  const { maxT, maxF } = curveExtent(usable.map((s) => s.points));
  if (maxT <= 0 || maxF <= 0) return null;

  const plotW = W - PAD_L;
  const plotH = H - PAD_B;

  // Assign each series a stroke + line style; the focus motor is solid/heavier.
  let overlayI = 0;
  const drawn = usable.map((s) => {
    const focus = s.emphasis;
    const color = focus ? undefined : OVERLAY_COLORS[overlayI++ % OVERLAY_COLORS.length];
    return {
      label: s.label,
      focus,
      color, // undefined → use currentColor via the theme-aware className
      dash: focus ? undefined : "5 4",
      d: curvePath(s.points, { width: plotW, height: plotH, maxT, maxF }),
      peak: peakThrust(s.points),
      burn: burnTime(s.points),
    };
  });

  const focus = drawn.find((d) => d.focus) ?? drawn[0];
  const ariaLabel =
    `Thrust curve for ${focus.label}: peak ${Math.round(focus.peak)} N over ` +
    `${focus.burn.toFixed(1)} s` +
    (drawn.length > 1 ? `, overlaid with ${drawn.length - 1} comparison curve(s).` : ".");

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full text-zinc-900 dark:text-zinc-100"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
      >
        {/* peak-thrust (y max) label, in the left gutter beside the plot top */}
        <text
          x={PAD_L - 5}
          y={11}
          textAnchor="end"
          className="fill-zinc-500 text-[10px] dark:fill-zinc-400"
        >
          {Math.round(maxF)} N
        </text>
        <g transform={`translate(${PAD_L},0)`}>
          {/* x-axis baseline (thrust = 0) */}
          <line
            x1={0}
            y1={plotH}
            x2={plotW}
            y2={plotH}
            className="stroke-zinc-300 dark:stroke-zinc-700"
            strokeWidth={1}
          />
          {drawn.map((d, i) =>
            d.d ? (
              <path
                key={i}
                d={d.d}
                fill="none"
                stroke={d.color ?? "currentColor"}
                strokeWidth={d.focus ? 2.5 : 1.5}
                strokeDasharray={d.dash}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={d.focus ? 1 : 0.85}
              />
            ) : null,
          )}
          {/* burn-time (x max) label, below the baseline at the right edge */}
          <text
            x={plotW}
            y={H - 3}
            textAnchor="end"
            className="fill-zinc-500 text-[10px] dark:fill-zinc-400"
          >
            {maxT.toFixed(1)} s
          </text>
        </g>
      </svg>

      {drawn.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
          {drawn.map((d, i) => (
            <li key={i} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={`inline-block h-2.5 w-2.5 rounded-sm ${
                  d.focus ? "bg-zinc-900 dark:bg-zinc-100" : ""
                }`}
                style={d.color ? { backgroundColor: d.color } : undefined}
              />
              <span className={d.focus ? "font-medium" : ""}>{d.label}</span>
              <span className="text-zinc-400 dark:text-zinc-500">
                {Math.round(d.peak)} N · {d.burn.toFixed(1)} s
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
