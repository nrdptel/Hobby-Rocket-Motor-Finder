import Link from "next/link";

import { ApiButton } from "./ApiButton";
import { ThemeToggle } from "./ThemeToggle";

/** Slim top bar (brand → home + theme toggle) for the pages that aren't the
 * catalog — the motor detail pages (the links shared to Reddit) and the alerts
 * manager. The catalog has its own full header; these otherwise had no brand,
 * nav, or theme control, so a shared link felt like a different, half-built site.
 *
 * `apiButton` defaults on; the /api page passes false (no point linking a page
 * to itself). */
export function SiteHeader({ apiButton = true }: { apiButton?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <Link
        href="/"
        className="text-sm font-semibold tracking-tight text-zinc-900 transition hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300"
      >
        HPR Motor Finder
      </Link>
      <div className="flex flex-col items-end gap-2">
        <ThemeToggle />
        {apiButton && <ApiButton />}
      </div>
    </div>
  );
}
