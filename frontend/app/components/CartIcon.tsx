/** Outline cart mark (matches the rest of the monochrome icon set) used by the
 * "Plan order" entry point and the How-it-works explainer, so the cart reads the
 * same everywhere instead of the 🛒 emoji (a full-colour glyph that varies by
 * platform). Stroke is currentColor; size comes from `className`. */
export function CartIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
    </svg>
  );
}
