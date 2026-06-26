/** Parent-brand eyebrow. The motor finder is one of several Fusion Space tools;
 * this small linked badge sits above the product name to place it under the
 * Fusion Space brand and let people discover the other tools at fusionspace.co.
 * Reuses the sparkle mark from the main site so the two read as one family. */
export function FusionSpaceBadge({ className = "" }: { className?: string }) {
  return (
    <a
      href="https://fusionspace.co"
      target="_blank"
      rel="noopener noreferrer"
      title="Fusion Space — free, polished tools for high-power rocketry"
      className={`group inline-flex w-fit items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/fusion-space-mark.svg"
        alt=""
        aria-hidden
        width={880}
        height={815}
        className="h-3.5 w-auto"
      />
      <span>Fusion Space</span>
      <span
        aria-hidden
        className="opacity-0 transition group-hover:opacity-100"
      >
        ↗
      </span>
    </a>
  );
}
