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

import {
  cheapestInStockListing,
  designationToSlug,
  formatImpulse,
  formatPrice,
  formatThrust,
  listingInStock,
  manufacturerLabel,
  manufacturerSlug,
  unitPriceCents,
} from "./derive-shared.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "..", "data");
const ogDir = resolve(here, "..", "public", "og");

const MIN_CLASS = "D";
const SIZE = { width: 1200, height: 630 };

// The pure derive/pack formatters used below come from ./derive-shared.mjs (the
// single script-side mirror of lib/derive.ts + lib/pack.ts, parity-tested there).

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

// Site-wide card — centered brand lockup, shared template with the rest of the
// Fusion Space tools (charge.fusionspace.co etc.) so they read as one family:
// sparkle mark → product name → tagline → domain on a dark background with a
// soft indigo glow. The only per-tool changes are the three strings (name,
// tagline, domain); type scale, glow, and mark are identical across tools. The
// name is sized to fill the frame at the same visual weight regardless of
// length — "HPR Motor Finder" runs longer than most, so it sits at 100px.
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
          "radial-gradient(56% 64% at 50% 31%, rgba(99,102,241,0.27) 0%, rgba(99,102,241,0) 76%)",
        color: "#fafafa",
        fontFamily: "sans-serif",
      },
    },
    h("img", { src: markUri, width: 130, height: 120, style: { marginBottom: 40 } }),
    h(
      "div",
      { style: { fontSize: 100, fontWeight: 800, lineHeight: 1.0, letterSpacing: "-0.03em" } },
      "HPR Motor Finder",
    ),
    h(
      "div",
      { style: { fontSize: 40, fontWeight: 600, color: "#d4d4d8", marginTop: 32, maxWidth: 1040 } },
      "Live motor stock and pricing across U.S. vendors",
    ),
    h(
      "div",
      { style: { fontSize: 26, color: "#818cf8", marginTop: 28, fontFamily: "monospace", letterSpacing: "0.02em" } },
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
