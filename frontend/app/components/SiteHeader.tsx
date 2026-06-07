import Link from "next/link";

import { ThemeToggle } from "./ThemeToggle";

/** Slim top bar (brand → home + theme toggle) for the pages that aren't the
 * catalog — the motor detail pages (the links shared to Reddit) and the alerts
 * manager. The catalog has its own full header; these otherwise had no brand,
 * nav, or theme control, so a shared link felt like a different, half-built site. */
export function SiteHeader() {
  return (
    <div className="flex items-center justify-between gap-4">
      <Link
        href="/"
        className="text-sm font-semibold tracking-tight text-zinc-900 transition hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300"
      >
        🚀 HPR Motor Finder
      </Link>
      <ThemeToggle />
    </div>
  );
}
