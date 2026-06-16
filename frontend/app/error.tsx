"use client";

import Link from "next/link";

// Route error boundary. The most likely trigger in production is a present-but-
// malformed stock snapshot (loadSnapshot throws SnapshotParseError), which would
// otherwise surface Next's bare error screen for the whole catalog. We show a
// friendly, on-brand recovery instead — and deliberately don't render the error
// message, to avoid leaking internals.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Something went wrong loading the data
      </h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        This is usually a brief hiccup with the latest stock snapshot. Try again in a moment.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full border border-zinc-900 bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Try again
        </button>
        <Link
          href="/"
          className="text-sm text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
        >
          Back to all motors
        </Link>
      </div>
    </main>
  );
}
