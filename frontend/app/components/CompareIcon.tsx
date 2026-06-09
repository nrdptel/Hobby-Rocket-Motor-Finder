/** Outline "compare" mark — two side-by-side panels — so the per-row Compare
 * toggle matches the monochrome star + bell beside it instead of a heavy text
 * pill. Stroke/fill follow currentColor; size comes from `className`. When
 * `filled` is set the panels fill in (the selected state), mirroring how the
 * star goes ☆ → ★. */
export function CompareIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="4" y="4" width="6.5" height="16" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="16" rx="1.5" />
    </svg>
  );
}
