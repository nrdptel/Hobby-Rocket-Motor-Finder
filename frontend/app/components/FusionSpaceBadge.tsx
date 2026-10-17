/** The FusionSpace horizontal lockup (Rev C: rocket cluster + wordmark), drawn
 * 24 px tall — the brand's minimum cluster height on screen, and the size the
 * fusionspace.co header uses (142 × 24). Below 32 px tall the brand rules call
 * for the one-colour Void lockup on light backgrounds (the thin gradient details
 * get too faint there) and allow the gradient lockup on dark, so this renders
 * both and lets the `dark:` variant (globals.css: class override + OS fallback)
 * show the right one with no script-timing dependency. The hidden <img> is
 * display:none, so assistive tech reads the alt text once. */
export function FusionSpaceLockup({ className = "" }: { className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/fusion-space-horizontal-void.svg"
        alt="FusionSpace"
        width={142}
        height={24}
        className={`h-6 w-auto shrink-0 dark:hidden ${className}`}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/fusion-space-wordmark.svg"
        alt="FusionSpace"
        width={142}
        height={24}
        className={`hidden h-6 w-auto shrink-0 dark:block ${className}`}
      />
    </>
  );
}

/** Parent-brand eyebrow. The motor finder is one of several FusionSpace tools;
 * this small linked lockup sits above the product name to place it under the
 * FusionSpace brand and let people discover the other tools at fusionspace.co.
 * Uses the official FusionSpace lockup from the main site so the two read as
 * one family. */
export function FusionSpaceBadge({ className = "" }: { className?: string }) {
  return (
    <a
      href="https://fusionspace.co"
      target="_blank"
      rel="noopener noreferrer"
      title="FusionSpace — free, polished tools for high-power rocketry"
      className={`group inline-flex w-fit items-center gap-1 transition hover:opacity-80 ${className}`}
    >
      <FusionSpaceLockup />
      <span
        aria-hidden
        className="text-xs text-zinc-400 opacity-0 transition group-hover:opacity-100 dark:text-zinc-500"
      >
        ↗
      </span>
    </a>
  );
}
