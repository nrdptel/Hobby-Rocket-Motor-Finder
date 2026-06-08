/** A tiny fixed-size thrust-curve glyph for a catalog row — the burn *shape* at
 * a glance (a flat-topped long burn vs. a spiky punch). The path is precomputed
 * server-side (see lib/curves `sparkPath`) and self-scaled, so this is purely
 * presentational. Renders nothing when there's no curve. */
export function ThrustSparkline({ d, className }: { d?: string; className?: string }) {
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 56 16"
      width={56}
      height={16}
      role="img"
      aria-label="thrust curve shape"
      preserveAspectRatio="none"
      className={`text-zinc-400 dark:text-zinc-500 ${className ?? ""}`}
    >
      <title>Thrust curve shape</title>
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
