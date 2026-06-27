// Pre-generate Open Graph PNGs at build time.
//
// The dynamic `opengraph-image.tsx` routes (site-wide + per-motor) rendered
// next/og ImageResponses on demand, reading the snapshot via fs. Static export
// forbids runtime fs / dynamic image routes, so we render the SAME layouts to
// static PNGs here instead:
//   public/og/default.png                                 (site-wide card)
//   public/og/motor/<manufacturer>/<designation>.png      (per-motor cards)
// The page generateMetadata then points openGraph/twitter.images at these paths.
//
// We use next/og's `ImageResponse` (Next's built-in OG image renderer), imported
// via the explicit `next/og.js` specifier so it resolves from a plain node
// script as well as inside Next's bundler. The OG layout JSX is reproduced with
// React.createElement so this stays a plain .mjs, matching the other prebuild
// scripts. The small derive formatters it needs are inlined below — kept in sync
// with lib/derive.ts (trivial, pure functions).
//
// Runs in `prebuild` after copy-snapshot.mjs. Idempotent.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import React from "react";
import { ImageResponse } from "next/og.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "..", "data");
const ogDir = resolve(here, "..", "public", "og");

const MIN_CLASS = "D";
const SIZE = { width: 1200, height: 630 };

// --- inlined derive formatters (mirror lib/derive.ts) ----------------------
function manufacturerLabel(m) {
  if (m === "Cesaroni Technology") return "Cesaroni";
  if (m === "Loki Research") return "Loki";
  return m;
}
const manufacturerSlug = (m) => manufacturerLabel(m).toLowerCase();
const designationToSlug = (d) => d.replaceAll("/", "~");
const formatImpulse = (ns) => (ns == null ? "—" : `${ns.toFixed(0)} N·s`);
const formatThrust = (n) => (n == null ? "—" : `${Math.round(n)} N`);
function formatPrice(cents, currency) {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}
// listingInStock: in_stock* statuses count as buyable (mirror lib/derive).
const IN_STOCK = new Set(["in_stock", "in_stock_with_count"]);
const listingInStock = (status) => IN_STOCK.has(status);
// packSize / unitPriceCents (pack-aware per-unit price) — mirror lib/pack.ts.
const MAX_PACK = 24;
function packFromUrl(url) {
  const m = /(\d+)\s*[- ]?\s*pack/i.exec(url || "");
  if (m) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n >= 2 && n <= MAX_PACK) return n;
  }
  return 1;
}
function packSize(l) {
  const ps = l.pack_size;
  if (ps != null) return Number.isInteger(ps) && ps >= 2 && ps <= MAX_PACK ? ps : 1;
  return packFromUrl(l.url ?? "");
}
function unitPriceCents(priceCents, l) {
  if (priceCents == null) return null;
  const n = packSize(l);
  return n > 1 ? Math.round(priceCents / n) : priceCents;
}
function cheapestInStockListing(m) {
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

// --- shared layout chrome --------------------------------------------------
const h = React.createElement;
const CARD_STYLE = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  alignItems: "flex-start",
  padding: "80px",
  background: "linear-gradient(135deg, #09090b 0%, #18181b 100%)",
  color: "#fafafa",
  fontFamily: "sans-serif",
  position: "relative",
};

function footer(logoUri) {
  return h(
    "div",
    {
      style: {
        position: "absolute",
        bottom: 58,
        left: 80,
        display: "flex",
        alignItems: "center",
        gap: 18,
        opacity: 0.85,
      },
    },
    h("img", { src: logoUri, width: 233, height: 52, alt: "Fusion Space" }),
    h(
      "span",
      { style: { fontSize: 26, color: "#a1a1aa", letterSpacing: "0.04em" } },
      "motor.fusionspace.co",
    ),
  );
}

// Site-wide card — centered brand lockup, in the clean style of the main
// fusionspace.co share card: sparkle mark → product name → tagline → domain on a
// dark background with a soft indigo glow.
function defaultCard(markUri) {
  return h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        background: "#09090b",
        backgroundImage:
          "radial-gradient(45% 55% at 50% 32%, rgba(99,102,241,0.28) 0%, rgba(99,102,241,0) 70%)",
        color: "#fafafa",
        fontFamily: "sans-serif",
      },
    },
    h("img", { src: markUri, width: 150, height: 139, style: { marginBottom: 44 } }),
    h(
      "div",
      { style: { fontSize: 90, fontWeight: 700, lineHeight: 1.0, letterSpacing: "-0.02em" } },
      "HPR Motor Finder",
    ),
    h(
      "div",
      { style: { fontSize: 34, fontWeight: 600, color: "#e4e4e7", marginTop: 36, maxWidth: 1040 } },
      "Live motor stock and pricing across U.S. vendors",
    ),
    h(
      "div",
      { style: { fontSize: 26, color: "#818cf8", marginTop: 30, fontFamily: "monospace", letterSpacing: "0.02em" } },
      "motor.fusionspace.co",
    ),
  );
}

// Per-motor card (mirrors app/motor/[manufacturer]/[designation]/opengraph-image.tsx).
function motorCard(motor, logoUri) {
  const subhead = `${manufacturerLabel(motor.manufacturer)} · ${motor.impulse_class}-class · ${motor.diameter_mm}mm${
    motor.propellant ? ` · ${motor.propellant}` : ""
  }`;
  const specLine = `${formatImpulse(motor.total_impulse_ns)}  ·  ${formatThrust(motor.avg_thrust_n)} avg`;
  const n = motor.listings.filter((l) => listingInStock(l.status)).length;
  const inStock = n > 0;
  const vendors = motor.listings.length;
  let stockLine;
  if (n > 0) {
    const cheapest = cheapestInStockListing(motor);
    const price =
      cheapest?.price_cents != null
        ? ` — from ${formatPrice(unitPriceCents(cheapest.price_cents, cheapest), cheapest.currency)}`
        : "";
    stockLine = `In stock at ${n} of ${vendors} vendor${vendors === 1 ? "" : "s"}${price}`;
  } else {
    stockLine = `Sold out at all ${vendors} tracked vendor${vendors === 1 ? "" : "s"}`;
  }

  return h(
    "div",
    { style: CARD_STYLE },
    h("div", { style: { fontSize: 30, color: "#a1a1aa", letterSpacing: "0.02em", marginBottom: 20 } }, subhead),
    h(
      "div",
      { style: { fontSize: 120, fontWeight: 700, lineHeight: 1.0, marginBottom: 28, letterSpacing: "-0.02em" } },
      motor.designation,
    ),
    h("div", { style: { fontSize: 40, color: "#d4d4d8", marginBottom: 28 } }, specLine),
    h(
      "div",
      { style: { fontSize: 38, fontWeight: 600, color: inStock ? "#34d399" : "#a1a1aa" } },
      stockLine,
    ),
    footer(logoUri),
  );
}

async function render(element) {
  const resp = new ImageResponse(element, { ...SIZE });
  return Buffer.from(await resp.arrayBuffer());
}

async function main() {
  // Extract the embedded data URIs (robust to formatting changes): the wordmark
  // for the per-motor footer, the sparkle mark for the centered default card.
  const logoSrc = await readFile(resolve(here, "..", "lib", "og-logo.ts"), "utf-8");
  const logoUri = logoSrc.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)?.[0];
  if (!logoUri) throw new Error("gen-og: could not extract OG_LOGO_PNG from lib/og-logo.ts");
  const markSrc = await readFile(resolve(here, "..", "lib", "og-mark.ts"), "utf-8");
  const markUri = markSrc.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)?.[0];
  if (!markUri) throw new Error("gen-og: could not extract OG_MARK_PNG from lib/og-mark.ts");

  await mkdir(ogDir, { recursive: true });

  // Site-wide default card.
  await writeFile(resolve(ogDir, "default.png"), await render(defaultCard(markUri)));
  console.log("gen-og: wrote public/og/default.png");

  // Per-motor cards for the SAME universe the dynamic route covered: stocked
  // motors (a listing) of class >= MIN_CLASS.
  let snapshot = null;
  try {
    snapshot = JSON.parse(await readFile(resolve(dataDir, "snapshot.json"), "utf-8"));
  } catch {
    try {
      snapshot = JSON.parse(await readFile(resolve(dataDir, "snapshot.example.json"), "utf-8"));
    } catch {
      snapshot = null;
    }
  }
  if (!snapshot) {
    console.log("gen-og: no snapshot — only the default card was generated");
    return;
  }

  const motors = snapshot.motors.filter(
    (m) => m.listings.length > 0 && m.impulse_class >= MIN_CLASS,
  );
  let written = 0;
  for (const m of motors) {
    const mfrDir = resolve(ogDir, "motor", manufacturerSlug(m.manufacturer));
    await mkdir(mfrDir, { recursive: true });
    const file = resolve(mfrDir, `${designationToSlug(m.designation)}.png`);
    await writeFile(file, await render(motorCard(m, logoUri)));
    written++;
    if (written % 100 === 0) console.log(`gen-og: ${written}/${motors.length} motor cards…`);
  }
  console.log(`gen-og: wrote ${written} per-motor cards under public/og/motor/`);
}

await main();
