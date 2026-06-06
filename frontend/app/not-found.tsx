import Link from "next/link";

// Custom 404 — reached by an unknown route or a motor detail page calling
// notFound() (mistyped slug, or a motor that's no longer in the catalog).
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <p className="text-4xl" aria-hidden>
        🔍
      </p>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Page not found
      </h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        That link may be mistyped, or it&apos;s a motor that isn&apos;t currently listed by any
        tracked vendor.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full border border-zinc-900 bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Browse all motors
      </Link>
    </main>
  );
}
