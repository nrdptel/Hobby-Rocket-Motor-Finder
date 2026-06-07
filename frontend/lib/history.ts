import { plausiblePair } from "./priceSignal";
import type { StockStatus } from "./snapshot";

// The hourly scrape only became cadence-reliable when an external cron took over
// on 2026-06-05; before that GitHub's best-effort `schedule` ran irregularly
// (gaps up to ~8h), which would distort any time-weighted availability stat. So
// every cadence-sensitive history feature clips its window to this epoch — we
// never draw a trend across the sparse early period. See docs/ops-scrape-cron.md
// and the `project_history_epoch` memo.
export const HISTORY_EPOCH = "2026-06-05T18:00:00Z";

// Don't headline a buyable-% until we've tracked a meaningful stretch — a few
// hours of data makes the fraction noise, not signal.
export const MIN_MEANINGFUL_WINDOW_MS = 12 * 60 * 60 * 1000;

// The two enum values that count as "in stock" — mirrors the backend's
// IN_STOCK_STATUSES so a flip between in_stock and in_stock_with_count is not a
// stock-state change.
const IN_STOCK = new Set<StockStatus>(["in_stock", "in_stock_with_count"]);

export function isInStock(status: StockStatus | null | undefined): boolean {
  return status != null && IN_STOCK.has(status);
}

// One change-only event from the backend history log (see backend history.py).
export type HistoryEvent = {
  t: string;
  status: StockStatus;
  price_cents: number | null;
};

export type ListingLog = {
  vendor_slug: string;
  events: HistoryEvent[];
};

// The raw event log, keyed by listing `url` — the backend's `history/log.json`.
export type HistoryLog = Record<string, ListingLog>;

type Interval = { start: number; end: number }; // epoch ms

// A timeline segment over the shared [trackStart, now] axis. `unknown` covers
// the stretch before a listing's first recorded event (we don't know its state
// then); `in`/`out` are observed.
export type SegmentKind = "in" | "out" | "unknown";
export type Segment = { kind: SegmentKind; widthFrac: number };

export type VendorTimeline = {
  vendorName: string;
  vendorSlug: string;
  currentlyInStock: boolean;
  segments: Segment[];
};

export type MotorAvailability = {
  // Window: [trackStart, now], where trackStart = max(epoch, earliest event).
  trackStartMs: number;
  nowMs: number;
  windowMs: number;
  // True once windowMs clears MIN_MEANINGFUL_WINDOW_MS — gate the headline %.
  meaningful: boolean;
  // Buyable somewhere (union of all vendors' in-stock time) / window.
  fraction: number;
  buyableMs: number;
  currentlyInStock: boolean;
  // End of the last buyable interval (== now when currently in stock), or null
  // if the motor was never observed in stock during the window.
  lastBuyableAtMs: number | null;
  priceLowCents: number | null;
  priceHighCents: number | null;
  // Motor-level "buyable somewhere" strip (union of all vendors), in/out only.
  timeline: Segment[];
  vendors: VendorTimeline[];
};

function parseMs(t: string | null | undefined): number {
  if (!t) return NaN;
  // Some event timestamps are stored timezone-naive (e.g. "2026-05-30T18:37:08").
  // Date.parse would read those in the HOST's local zone, while our epoch + `now`
  // are UTC — so on any non-UTC host the window would skew by the host offset.
  // The backend treats naive timestamps as UTC (history.py `_parse`), so we must
  // too: append a 'Z' when there's no zone designator.
  const zoned = /[zZ]$|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`;
  return Date.parse(zoned);
}

// Defensive: the backend appends events in chronological order, but the interval
// and segment math depends on it, so never trust the input — sort a copy by time.
function sortedEvents(events: HistoryEvent[]): HistoryEvent[] {
  return [...events].sort((a, b) => parseMs(a.t) - parseMs(b.t));
}

/** In-stock intervals for one listing's events, clipped to [windowStart, now].
 * A listing's state is carried forward from each event until the next (the last
 * extends to `now`); events fully before the window are clipped in, not dropped,
 * so the state *at* windowStart is honoured. */
function inStockIntervals(events: HistoryEvent[], windowStart: number, now: number): Interval[] {
  const out: Interval[] = [];
  for (let i = 0; i < events.length; i++) {
    const tMs = parseMs(events[i].t);
    if (Number.isNaN(tMs)) continue;
    const nextRaw = i + 1 < events.length ? parseMs(events[i + 1].t) : now;
    const next = Number.isNaN(nextRaw) ? now : nextRaw;
    const start = Math.max(tMs, windowStart);
    const end = Math.min(next, now);
    if (end <= start) continue;
    if (isInStock(events[i].status)) out.push({ start, end });
  }
  return out;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) last.end = Math.max(last.end, sorted[i].end);
    else merged.push({ ...sorted[i] });
  }
  return merged;
}

/** Render a set of (sorted, non-overlapping) in-stock intervals as in/out
 * segments spanning [a, b] — the gaps between intervals are `out`. Used for the
 * motor-level "buyable somewhere" union strip. */
function intervalsToSegments(merged: Interval[], a: number, b: number): Segment[] {
  const span = b - a;
  if (span <= 0) return [];
  const segs: Segment[] = [];
  let cursor = a;
  for (const iv of merged) {
    const start = Math.max(iv.start, a);
    const end = Math.min(iv.end, b);
    if (end <= start) continue;
    if (start > cursor) segs.push({ kind: "out", widthFrac: (start - cursor) / span });
    segs.push({ kind: "in", widthFrac: (end - start) / span });
    cursor = end;
  }
  if (cursor < b) segs.push({ kind: "out", widthFrac: (b - cursor) / span });
  return segs;
}

/** Per-vendor in/out/unknown segments spanning the shared [trackStart, now]
 * axis, as fractions that sum to 1. Adjacent same-kind segments are collapsed. */
function vendorSegments(events: HistoryEvent[], trackStart: number, now: number): Segment[] {
  const span = now - trackStart;
  if (span <= 0) return [];
  const raw: { kind: SegmentKind; start: number; end: number }[] = [];

  const firstMs = events.length ? parseMs(events[0].t) : NaN;
  // Before the first event (or for an event-less listing) the state is unknown.
  // Clamp to `now` so a future-dated first event can't make the unknown segment
  // exceed the axis (widthFrac > 1).
  const knownFrom = Number.isNaN(firstMs) ? now : Math.min(now, Math.max(firstMs, trackStart));
  if (knownFrom > trackStart) raw.push({ kind: "unknown", start: trackStart, end: knownFrom });

  for (let i = 0; i < events.length; i++) {
    const tMs = parseMs(events[i].t);
    if (Number.isNaN(tMs)) continue;
    const nextRaw = i + 1 < events.length ? parseMs(events[i + 1].t) : now;
    const next = Number.isNaN(nextRaw) ? now : nextRaw;
    const start = Math.max(tMs, trackStart);
    const end = Math.min(next, now);
    if (end <= start) continue;
    raw.push({ kind: isInStock(events[i].status) ? "in" : "out", start, end });
  }

  // Collapse adjacent same-kind runs, then convert to fractions.
  const collapsed: { kind: SegmentKind; start: number; end: number }[] = [];
  for (const seg of raw) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.kind === seg.kind && Math.abs(last.end - seg.start) < 1) last.end = seg.end;
    else collapsed.push({ ...seg });
  }
  return collapsed.map((s) => ({ kind: s.kind, widthFrac: (s.end - s.start) / span }));
}

type BuyableWindow = {
  trackStart: number;
  windowMs: number;
  buyable: Interval[];
  buyableMs: number;
  currentlyInStock: boolean;
};

/** Core motor-level availability over [max(epoch, earliest event), now] for a
 * set of per-listing event lists — the "buyable somewhere" union. Returns null
 * when there's no history at all. Shared by buildMotorAvailability (detail page)
 * and catalogAvailability (catalog badges) so they can never disagree. */
function buyableWindow(eventLists: HistoryEvent[][], epoch: number, now: number): BuyableWindow | null {
  const withEvents = eventLists.filter((e) => e.length > 0);
  if (withEvents.length === 0) return null;
  let earliest = Infinity;
  for (const evs of withEvents) {
    const f = parseMs(evs[0].t);
    if (!Number.isNaN(f)) earliest = Math.min(earliest, f);
  }
  const trackStart = Math.max(epoch, Number.isFinite(earliest) ? earliest : epoch);
  const windowMs = Math.max(0, now - trackStart);
  const buyable = mergeIntervals(withEvents.flatMap((evs) => inStockIntervals(evs, trackStart, now)));
  const buyableMs = buyable.reduce((sum, iv) => sum + (iv.end - iv.start), 0);
  const currentlyInStock = withEvents.some((evs) => isInStock(evs[evs.length - 1].status));
  return { trackStart, windowMs, buyable, buyableMs, currentlyInStock };
}

/** Build the motor-level availability summary + per-vendor timelines from the
 * raw event log, clipped to the reliable-cadence epoch.
 *
 * `listings` are the motor's snapshot listings (for vendor names + the url key);
 * their events are looked up in `log` by url. `nowIso` is the snapshot's
 * generated_at. Returns null when there is no history at all for this motor. */
export function buildMotorAvailability(
  listings: { url: string; vendor_name: string; vendor_slug: string }[],
  log: HistoryLog,
  nowIso: string,
  epochIso: string = HISTORY_EPOCH,
): MotorAvailability | null {
  const now = parseMs(nowIso);
  const epoch = parseMs(epochIso);
  if (Number.isNaN(now) || Number.isNaN(epoch)) return null;

  const withEvents = listings
    .map((l) => ({ ...l, events: sortedEvents(log[l.url]?.events ?? []) }))
    .filter((l) => l.events.length > 0);
  if (withEvents.length === 0) return null;

  // Core availability window — shared with catalogAvailability so the two can't
  // drift. Non-null here because withEvents is non-empty.
  const { trackStart, windowMs, buyable, buyableMs, currentlyInStock } = buyableWindow(
    withEvents.map((l) => l.events),
    epoch,
    now,
  )!;
  const lastBuyableAtMs = buyable.length ? buyable[buyable.length - 1].end : null;

  let priceLow: number | null = null;
  let priceHigh: number | null = null;
  for (const l of withEvents) {
    for (const e of l.events) {
      if (e.price_cents == null) continue;
      if (Number.isNaN(parseMs(e.t)) || parseMs(e.t) < trackStart) continue;
      priceLow = priceLow == null ? e.price_cents : Math.min(priceLow, e.price_cents);
      priceHigh = priceHigh == null ? e.price_cents : Math.max(priceHigh, e.price_cents);
    }
  }

  // Drop the range if low/high aren't a trustworthy pair — same noise guard the
  // price signal uses, so a misparsed reading can't print "$29.74–$277.19".
  if (priceLow != null && priceHigh != null && !plausiblePair(priceLow, priceHigh)) {
    priceLow = null;
    priceHigh = null;
  }

  const vendors: VendorTimeline[] = withEvents.map((l) => ({
    vendorName: l.vendor_name,
    vendorSlug: l.vendor_slug,
    currentlyInStock: isInStock(l.events[l.events.length - 1].status),
    segments: vendorSegments(l.events, trackStart, now),
  }));

  return {
    trackStartMs: trackStart,
    nowMs: now,
    windowMs,
    meaningful: windowMs >= MIN_MEANINGFUL_WINDOW_MS,
    fraction: windowMs > 0 ? Math.min(1, buyableMs / windowMs) : 0,
    buyableMs,
    currentlyInStock,
    lastBuyableAtMs: currentlyInStock ? now : lastBuyableAtMs,
    priceLowCents: priceLow,
    priceHighCents: priceHigh,
    timeline: intervalsToSegments(buyable, trackStart, now),
    vendors,
  };
}

// Compact per-motor availability for the catalog list — just enough to drive a
// badge, computed server-side and shipped as one small record per motor (no
// timelines). `windowMs` lets the badge withhold an assertive scarcity claim
// until enough time has been tracked (a 12h `meaningful` floor is fine for a
// neutral %, but "rarely in stock" needs a longer window to be honest).
export type CatalogAvailability = {
  fraction: number;
  meaningful: boolean;
  windowMs: number;
  currentlyInStock: boolean;
};

/** Compute a compact availability summary for every motor that has history,
 * keyed by motor id. Reuses the same buyable-window core as the detail page, so
 * a catalog badge and the detail page can't tell different stories. */
export function catalogAvailability(
  motors: { id: number; listings: { url: string }[] }[],
  log: HistoryLog,
  nowIso: string,
  epochIso: string = HISTORY_EPOCH,
): Record<number, CatalogAvailability> {
  const now = parseMs(nowIso);
  const epoch = parseMs(epochIso);
  const out: Record<number, CatalogAvailability> = {};
  if (Number.isNaN(now) || Number.isNaN(epoch)) return out;
  for (const m of motors) {
    const core = buyableWindow(
      m.listings.map((l) => sortedEvents(log[l.url]?.events ?? [])),
      epoch,
      now,
    );
    if (!core) continue;
    out[m.id] = {
      fraction: core.windowMs > 0 ? Math.min(1, core.buyableMs / core.windowMs) : 0,
      meaningful: core.windowMs >= MIN_MEANINGFUL_WINDOW_MS,
      windowMs: core.windowMs,
      currentlyInStock: core.currentlyInStock,
    };
  }
  return out;
}

/** Compact human duration like ``5 hours`` / ``3 days`` (min ``1 hour``). For
 * the "since tracking began (N)" window label. */
export function formatWindow(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 48) {
    const h = Math.max(1, Math.round(hours));
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(hours / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** Compact "ago" age like ``3h`` / ``2d`` (min ``1h``). */
export function formatAgo(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h`;
  return `${Math.round(hours / 24)}d`;
}
