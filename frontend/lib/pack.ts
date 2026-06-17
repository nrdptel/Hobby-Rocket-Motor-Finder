// Multipack detection + per-unit pricing. Some vendors list a motor in 2/3/12
// packs (low/mid-power only — HPR reloads aren't sold this way), and the scraped
// price is for the WHOLE pack. Showing that as a single-motor price mis-states
// the cost, so the catalog compares and displays by PER-UNIT price.
//
// The pack size is resolved at snapshot-export time and carried on each listing
// as `pack_size` (see backend/hpr_finder/pack.py — it parses the size out of the
// URL where present and infers the rest from cross-vendor consensus). These
// helpers prefer that field and fall back to parsing the URL themselves, so they
// still work for a bare URL string and for older snapshots lacking the field.

// Matches the digit-led forms: "3-pack" / "3 pack" / "3 packs" / "12-pack" /
// "3pk" / "2-pk" / "2 - pack" / "2-motor-pack" / "pack of 3". Separators are
// hyphen/space (any run), an optional "motor" word is allowed before "pack(s)".
const PACK_RE = /(\d+)[-\s]*(?:motor[-\s]*)?packs?\b|(\d+)[-\s]*pks?\b|pack\s*of\s*(\d+)/i;
// And the spelled-out forms vendors actually use: "two pack", "three-pack".
const WORD_PACK_RE = /\b(two|three|four|six|twelve)[-\s]*(?:motor[-\s]*)?packs?\b/i;
const WORD_TO_N: Record<string, number> = { two: 2, three: 3, four: 4, six: 6, twelve: 12 };
// A single SKU isn't a 24-pack of motors; a bigger number is almost certainly
// something else in the URL, so don't trust it as a pack count.
const MAX_PACK = 24;

/** A listing (or anything carrying the pack signal) to size a pack from. A bare
 * URL string is accepted too, for callers that only have the link. */
export type PackSource = string | { url?: string | null; pack_size?: number | null };

function packFromUrl(url: string): number {
  if (!url) return 1;
  let u: string;
  try {
    u = decodeURIComponent(url);
  } catch {
    u = url; // malformed %-escapes — fall back to the raw string
  }
  const m = PACK_RE.exec(u);
  if (m) {
    const n = Number(m[1] ?? m[2] ?? m[3]);
    return Number.isInteger(n) && n >= 2 && n <= MAX_PACK ? n : 1;
  }
  const w = WORD_PACK_RE.exec(u);
  return w ? (WORD_TO_N[w[1].toLowerCase()] ?? 1) : 1;
}

/** The pack quantity for a listing: the snapshot-resolved ``pack_size`` when
 * present, else parsed from the URL, else 1 (a single). Never throws. */
export function packSize(source: PackSource): number {
  if (typeof source !== "string") {
    const ps = source.pack_size;
    if (ps != null) return Number.isInteger(ps) && ps >= 2 && ps <= MAX_PACK ? ps : 1;
    return packFromUrl(source.url ?? "");
  }
  return packFromUrl(source);
}

/** The per-motor price for a listing: the pack price divided by the pack size
 * (rounded), or the price unchanged for a single. Null in → null out. This is
 * the honest figure to rank and compare by. */
export function unitPriceCents(priceCents: number | null, source: PackSource): number | null {
  if (priceCents == null) return null;
  const n = packSize(source);
  return n > 1 ? Math.round(priceCents / n) : priceCents;
}
