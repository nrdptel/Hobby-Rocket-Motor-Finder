"use client";

import Link from "next/link";

import { MAX_COMPARE, useCompare } from "@/lib/compareSelection";

/** A floating bottom bar that appears once you've picked motors to compare. Lists
 * the picks as removable chips and links to the compare view (enabled at 2+).
 * Selection lives in localStorage (useCompare), so it survives navigation and the
 * compare link is shareable. Renders nothing until hydration / first pick. */
export function CompareTray({ labels }: { labels: Record<number, string> }) {
  const { selected, count, toggle, clear, hydrated } = useCompare();
  if (!hydrated || count === 0) return null;

  // Stable order for the chips + the shareable ?ids= URL.
  const ids = [...selected].sort((a, b) => a - b);
  const href = `/compare?ids=${ids.join(",")}`;
  const ready = count >= 2;

  return (
    <>
      {/* In-flow spacer so the fixed bar never covers the page footer/last rows. */}
      <div aria-hidden className="h-16" />
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Compare ({count}/{MAX_COMPARE})
        </span>
        <ul className="flex flex-wrap items-center gap-1.5">
          {ids.map((id) => (
            <li key={id}>
              <span className="inline-flex items-center gap-1 rounded border border-zinc-300 bg-zinc-50 py-0.5 pl-2 pr-1 font-mono text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {labels[id] ?? `#${id}`}
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  aria-label={`Remove ${labels[id] ?? `motor ${id}`} from comparison`}
                  className="cursor-pointer rounded px-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={clear}
            className="cursor-pointer text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Clear
          </button>
          {ready ? (
            <Link
              href={href}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              Compare {count} motors
            </Link>
          ) : (
            <span
              className="cursor-not-allowed rounded-md bg-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
              title="Pick at least 2 motors to compare"
            >
              Compare
            </span>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
