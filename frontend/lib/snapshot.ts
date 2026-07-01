import { readFile } from "node:fs/promises";
import path from "node:path";

import { cache } from "react";

import type { CatalogRecord } from "./catalogMotors";
import type { HistoryLog } from "./history";
import type { Snapshot, HistorySummary } from "./snapshotTypes";

// The data types live in the pure ./snapshotTypes module (no fs), re-exported
// here so existing `import { Motor } from "@/lib/snapshot"` callers are
// unchanged. Client/edge code that must not drag in this file's fs loader can
// import the types from ./snapshotTypes directly.
export type {
  StockStatus,
  Listing,
  Motor,
  UnmatchedListing,
  Snapshot,
  ListingHistory,
  HistorySummary,
  CatalogListingHistory,
  CatalogHistorySummary,
} from "./snapshotTypes";

// Both snapshots live inside the frontend project at build time. The actual
// source-of-truth files are in the repo's top-level `data/` dir; the prebuild
// `copy-snapshot.mjs` script copies them in before `next build`/`next dev`
// runs. This indirection is required because Next 16 + Turbopack refuses
// file traces outside the project root, so reading from `../data/` would
// not survive the static export / deployment to Cloudflare Pages.
//
// The data directory (`<cwd>/data`) holding both the live snapshot
// (`snapshot.json`, copied from `<repo>/data/` when present) and the frozen
// reference seed (`snapshot.example.json`, tracked in git) that lets the UI
// render before any live scrape has run. Injectable into loadSnapshot as an
// argument so tests can point at a throwaway temp dir instead of mutating the
// real working-copy files the dev server reads.
const DATA_DIR = path.resolve(process.cwd(), "data");
// Compact per-listing history summary — copied in from
// `<repo>/data/history/summary.json` by `copy-snapshot.mjs`. Optional: a fresh
// clone (or a deploy before the first backfill) simply has no history overlay.
const HISTORY_SUMMARY_PATH = path.resolve(
  process.cwd(), "data", "history-summary.json"
);
// Full change-only event log — copied in from `<repo>/data/history/log.json`.
// Larger than the summary, so it's loaded ONLY where a per-listing timeline is
// drawn (the motor detail page); the caller slices out just the listings it
// needs. Optional, and degrades to "no history" exactly like the summary.
const HISTORY_LOG_PATH = path.resolve(process.cwd(), "data", "history-log.json");
// The ThrustCurve catalog files (copied in by copy-snapshot.mjs), used to build
// the "phantom" motors no tracked vendor stocks. Optional like the snapshot.
const CATALOG_PATHS = [
  "thrustcurve_aerotech.json",
  "thrustcurve_cesaroni.json",
  "thrustcurve_loki.json",
].map((f) => path.resolve(process.cwd(), "data", f));

export class SnapshotParseError extends Error {
  constructor(path: string, cause: unknown) {
    super(`Could not parse snapshot at ${path}: ${(cause as Error)?.message ?? cause}`);
    this.name = "SnapshotParseError";
    this.cause = cause;
  }
}

async function loadSnapshotImpl(dataDir: string = DATA_DIR): Promise<Snapshot | null> {
  const candidates = [
    path.join(dataDir, "snapshot.json"),
    path.join(dataDir, "snapshot.example.json"),
  ];
  for (const candidate of candidates) {
    let raw: string;
    try {
      raw = await readFile(candidate, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    try {
      return JSON.parse(raw) as Snapshot;
    } catch (err) {
      // Distinguish "missing file" (fall through) from "file present but
      // malformed" — the latter is a real bug and should surface, not
      // silently fall back to the example seed.
      throw new SnapshotParseError(candidate, err);
    }
  }
  return null;
}

/** Load the per-listing history summary, keyed by listing `url`. History is a
 * nice-to-have overlay on top of the snapshot, so a missing OR malformed file
 * degrades gracefully to "no history" ({}) rather than taking down the page. */
async function loadHistorySummaryImpl(): Promise<HistorySummary> {
  let raw: string;
  try {
    raw = await readFile(HISTORY_SUMMARY_PATH, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    return JSON.parse(raw) as HistorySummary;
  } catch {
    return {};
  }
}

/** Load the full change-only event log, keyed by listing `url`. Like the
 * summary, a missing OR malformed file degrades gracefully to "no history"
 * ({}). The on-disk file wraps the map in `{version, updated_at, listings}`; we
 * return just the `listings` map (the shape `lib/history.ts` consumes). */
async function loadHistoryLogImpl(): Promise<HistoryLog> {
  let raw: string;
  try {
    raw = await readFile(HISTORY_LOG_PATH, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as { listings?: HistoryLog };
    return parsed.listings ?? {};
  } catch {
    return {};
  }
}

/** Load the merged ThrustCurve catalog (AeroTech/Cesaroni/Loki). A missing or
 * malformed file is skipped, so the catalog degrades to "fewer phantoms" rather
 * than taking down the page. */
async function loadCatalogMotorsImpl(): Promise<CatalogRecord[]> {
  const out: CatalogRecord[] = [];
  for (const p of CATALOG_PATHS) {
    let raw: string;
    try {
      raw = await readFile(p, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    try {
      out.push(...(JSON.parse(raw) as CatalogRecord[]));
    } catch {
      /* skip a malformed catalog file */
    }
  }
  return out;
}

// Wrapped in React cache() so multiple calls within one server render parse each
// file once, not 2–3× — e.g. the detail page reads the snapshot in
// generateMetadata AND in the page body (both via findMotor).
export const loadSnapshot = cache(loadSnapshotImpl);
export const loadHistorySummary = cache(loadHistorySummaryImpl);
export const loadHistoryLog = cache(loadHistoryLogImpl);
export const loadCatalogMotors = cache(loadCatalogMotorsImpl);
