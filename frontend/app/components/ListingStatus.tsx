import type { HistorySummary, Listing } from "@/lib/snapshot";
import { RestockBadge } from "./RestockBadge";
import { StaleBadge } from "./StaleBadge";
import { StatusBadge } from "./StatusBadge";

/** The per-listing status cluster — stock status, restock marker, and staleness
 * — shared by the desktop table (MotorResults) and the mobile card (MotorCard)
 * so the two can't drift. `now` is the snapshot time the relative markers are
 * measured against. */
export function ListingStatus({
  listing,
  history,
  now,
}: {
  listing: Listing;
  history: HistorySummary;
  now: Date;
}) {
  return (
    <>
      <StatusBadge status={listing.status} count={listing.stock_count} leadTime={listing.lead_time} />
      <RestockBadge history={history[listing.url]} now={now} />
      <StaleBadge seenAt={listing.seen_at} now={now} />
    </>
  );
}
