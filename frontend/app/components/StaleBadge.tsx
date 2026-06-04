import { staleLabel } from "@/lib/derive";

/** Amber "Nh/Nd old" marker shown next to a listing's status when its
 * ``seen_at`` lags the snapshot's ``generated_at`` — i.e. a vendor whose data
 * was carried forward from an earlier scrape. Renders nothing when the data is
 * fresh. Shared by the desktop table and the mobile card so the threshold and
 * tooltip copy stay in one place. */
export function StaleBadge({ seenAt, now }: { seenAt: string; now: Date }) {
  const label = staleLabel(seenAt, now);
  if (!label) return null;
  return (
    <span
      className="ml-1.5 text-xs text-amber-500/80"
      title={`This vendor's data was last refreshed ${new Date(seenAt).toLocaleString()} — likely carried forward from an earlier scrape.`}
    >
      {label}
    </span>
  );
}
