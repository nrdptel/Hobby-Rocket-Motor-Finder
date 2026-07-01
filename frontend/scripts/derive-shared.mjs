// Single script-side source for the small pure helpers the prebuild scripts
// need — pack sizing, per-unit price, sentinel/price/spec formatting, in-stock
// test, hazmat status, and manufacturer/designation slugs.
//
// The site's canonical implementations live in TypeScript (lib/pack.ts +
// lib/derive.ts) and drive what the pages render. The prebuild scripts
// (gen-api.mjs → the public /api/v1 JSON, gen-og.mjs → the share-card PNGs) run
// as plain node .mjs BEFORE the Next build, so they can't import that TS
// directly. They used to each carry their own inlined copy of these helpers;
// those copies drifted (a weaker pack regex, a missing sentinel-price guard), so
// the API and OG cards computed per-unit prices differently from the site. This
// module is the ONE shared copy both scripts import instead.
//
// It is a faithful mirror of lib/pack.ts + lib/derive.ts and is pinned to them
// by lib/scriptParity.test.ts, which runs every exported function here against
// its lib/ counterpart over a battery of adversarial inputs and the example
// snapshot. If lib/ changes, that test fails until this is updated — the sync is
// enforced, not just hoped for. Keep this dependency-free (pure functions only).

// --- in-stock (mirror lib/derive.ts listingInStock) ------------------------
const IN_STOCK = new Set(["in_stock", "in_stock_with_count"]);
/** True when a listing's status means a customer could buy it right now. */
export const listingInStock = (status) => IN_STOCK.has(status);

// --- pack sizing (mirror lib/pack.ts) --------------------------------------
// Matches the digit-led forms: "3-pack" / "3 pack" / "3 packs" / "12-pack" /
// "3pk" / "2-pk" / "2 - pack" / "2-motor-pack" / "pack of 3".
const PACK_RE = /(\d+)[-\s]*(?:motor[-\s]*)?packs?\b|(\d+)[-\s]*pks?\b|pack\s*of\s*(\d+)/i;
// And the spelled-out forms vendors actually use: "two pack", "three-pack".
const WORD_PACK_RE = /\b(two|three|four|six|twelve)[-\s]*(?:motor[-\s]*)?packs?\b/i;
const WORD_TO_N = { two: 2, three: 3, four: 4, six: 6, twelve: 12 };
// A single SKU isn't a 24-pack of motors; a bigger number is almost certainly
// something else in the URL, so don't trust it as a pack count.
const MAX_PACK = 24;

function packFromUrl(url) {
  if (!url) return 1;
  let u;
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
 * present, else parsed from the URL, else 1. Accepts a bare URL string too.
 * Never throws. */
export function packSize(source) {
  if (typeof source !== "string") {
    const ps = source.pack_size;
    if (ps != null) return Number.isInteger(ps) && ps >= 2 && ps <= MAX_PACK ? ps : 1;
    return packFromUrl(source.url ?? "");
  }
  return packFromUrl(source);
}

/** Per-motor price for a listing: the pack price ÷ pack size (rounded), or the
 * price unchanged for a single. Null in → null out. */
export function unitPriceCents(priceCents, source) {
  if (priceCents == null) return null;
  const n = packSize(source);
  return n > 1 ? Math.round(priceCents / n) : priceCents;
}

/** The pack-aware cheapest in-stock listing for a motor (per unit), falling back
 * to any in-stock listing when none is priced. Null when nothing is in stock. */
export function cheapestInStockListing(m) {
  let best = null;
  let bestUnit = Number.POSITIVE_INFINITY;
  for (const l of m.listings) {
    if (!listingInStock(l.status)) continue;
    const unit = unitPriceCents(l.price_cents, l);
    if (unit == null) continue;
    if (unit < bestUnit) {
      best = l;
      bestUnit = unit;
    }
  }
  return best ?? m.listings.find((l) => listingInStock(l.status)) ?? null;
}

// --- prices (mirror lib/derive.ts isSentinelPrice / formatPrice) -----------
/** A storefront "not for sale" placeholder is an all-nines value ($99,999.99+).
 * Hide only those — real HPR motors top out around $9,999. */
export function isSentinelPrice(cents) {
  if (cents == null) return false;
  const dollars = Math.floor(cents / 100);
  return dollars >= 99999 && /^9+$/.test(String(dollars));
}

/** Format integer cents as a currency string, hiding sentinel placeholders and
 * falling back to a plain dollar string on an invalid ISO currency code. */
export function formatPrice(cents, currency) {
  if (cents == null || isSentinelPrice(cents)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

/** Total impulse in newton-seconds. ``237`` → ``237 N·s``. */
export const formatImpulse = (ns) => (ns == null ? "—" : `${ns.toFixed(0)} N·s`);
/** Average thrust in newtons. ``242`` → ``242 N``. */
export const formatThrust = (n) => (n == null ? "—" : `${Math.round(n)} N`);

// --- hazmat (mirror lib/derive.ts hazmatStatus) ----------------------------
export const HAZMAT_PROP_WEIGHT_G = 62.5;
const isHighPowerClass = (cls) => cls.length === 1 && cls >= "H" && cls <= "Z";
/** DOT hazmat-shipping status: hybrids exempt (inert fuel grain), H+ or >62.5g
 * propellant required, F/G near the limit varies by vendor, A–E none. */
export function hazmatStatus(m) {
  if (m.motor_type === "hybrid") return "none";
  const cls = (m.impulse_class || "").toUpperCase();
  if (isHighPowerClass(cls)) return "required";
  if (m.prop_weight_g != null && m.prop_weight_g > HAZMAT_PROP_WEIGHT_G) return "required";
  if (cls === "F" || cls === "G") return "varies";
  return "none";
}

// --- slugs (mirror lib/derive.ts manufacturer/designation helpers) ---------
/** Short display name for a manufacturer ("Cesaroni Technology" → "Cesaroni"). */
export function manufacturerLabel(m) {
  if (m === "Cesaroni Technology") return "Cesaroni";
  if (m === "Loki Research") return "Loki";
  return m;
}
export const manufacturerSlug = (m) => manufacturerLabel(m).toLowerCase();
export const designationToSlug = (d) => d.replaceAll("/", "~");
