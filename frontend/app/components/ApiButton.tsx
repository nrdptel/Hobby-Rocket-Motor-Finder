import Link from "next/link";

/** Small link-button to the public API docs. Sized to match <ThemeToggle> so it
 * stacks cleanly beneath it; given a sky accent so it stands out from the
 * neutral theme control and is easy to spot. */
export function ApiButton() {
  return (
    <Link
      href="/api"
      title="Free public JSON API — live motor stock & pricing data"
      className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 transition hover:border-sky-400 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-300 dark:hover:border-sky-500/60 dark:hover:bg-sky-950/50"
    >
      <span aria-hidden className="font-mono text-[13px] leading-none">
        {"</>"}
      </span>
      API
    </Link>
  );
}
