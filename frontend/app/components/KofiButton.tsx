/** Small "buy me a coffee" link to the project's Ko-fi page. Amber accent + a
 * coffee cup so it reads as a tip jar, distinct from the emerald Plan-order and
 * sky API buttons. Sized to match <ApiButton> so the two sit cleanly side by
 * side in the header on both desktop and mobile.
 *
 * Label is "Tip" (not "Donate") deliberately: Stripe — Ko-fi's payment
 * processor — restricts "donation/donate" to registered non-profits and flags
 * its use by individuals, so optional payments for content must be framed as
 * "tips". */
export function KofiButton() {
  return (
    <a
      href="https://ko-fi.com/nrdptel"
      target="_blank"
      rel="noopener noreferrer"
      title="Tip the project — buy me a coffee on Ko-fi"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 transition hover:border-amber-400 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:border-amber-500/60 dark:hover:bg-amber-950/50"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="h-3.5 w-3.5"
      >
        <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
        <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
        <line x1="6" x2="6" y1="1" y2="4" />
        <line x1="10" x2="10" y1="1" y2="4" />
        <line x1="14" x2="14" y1="1" y2="4" />
      </svg>
      Tip
    </a>
  );
}
