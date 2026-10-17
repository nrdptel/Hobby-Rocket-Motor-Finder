// Pre-generate Open Graph PNGs at build time.
//
// The dynamic `opengraph-image.tsx` routes (site-wide + per-motor) rendered
// next/og ImageResponses on demand, reading the snapshot via fs. Static export
// forbids runtime fs / dynamic image routes, so we render the SAME layouts to
// static PNGs here instead:
//   public/og/motor/<manufacturer>/<designation>.png      (per-motor cards)
// The page generateMetadata then points openGraph/twitter.images at these paths.
//
// The site-wide card, public/og/default.png, is NOT generated here: it is the
// FusionSpace brand kit's ready-made HPR Motor Finder card (Rev C), committed as
// a static file. Replace that file to change it.
//
// We use next/og's `ImageResponse` (Next's built-in OG image renderer), imported
// via the explicit `next/og.js` specifier so it resolves from a plain node
// script as well as inside Next's bundler. The OG layout JSX is reproduced with
// React.createElement so this stays a plain .mjs, matching the other prebuild
// scripts. The derive/pack formatters it needs come from ./derive-shared.mjs (the
// single script-side mirror of lib/, pinned by lib/scriptParity.test.ts).
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
  // Real Geist weights are embedded (see main()) so the hero designation renders
  // in Bold and the stock line in SemiBold, matching their fontWeight below.
  fontFamily: "Geist",
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
    // Rev C horizontal lockup (1000 x 169 PNG), drawn at its own aspect ratio.
    h("img", { src: logoUri, width: 237, height: 40, alt: "FusionSpace" }),
    h(
      "span",
      { style: { fontSize: 26, color: "#a1a1aa", letterSpacing: "0.04em" } },
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

async function render(element, fonts) {
  // `fonts` embeds specific Geist weights so bold/semibold text actually renders
  // heavier; omitted, next/og falls back to its built-in Geist Regular only.
  const resp = new ImageResponse(element, fonts ? { ...SIZE, fonts } : { ...SIZE });
  return Buffer.from(await resp.arrayBuffer());
}

async function main() {
  // Extract the embedded data URI (robust to formatting changes): the lockup
  // for the per-motor footer.
  const logoSrc = await readFile(resolve(here, "..", "lib", "og-logo.ts"), "utf-8");
  const logoUri = logoSrc.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)?.[0];
  if (!logoUri) throw new Error("gen-og: could not extract OG_LOGO_PNG from lib/og-logo.ts");

  // Vendored Geist weights (next/og only bundles Regular). Kept local so the
  // build never depends on a font fetch, so the per-motor hero designation
  // renders in Bold and the stock line in SemiBold.
  const fontsDir = resolve(here, "fonts");
  const geistFonts = [
    { name: "Geist", data: await readFile(resolve(fontsDir, "Geist-Regular.ttf")), weight: 400, style: "normal" },
    { name: "Geist", data: await readFile(resolve(fontsDir, "Geist-SemiBold.ttf")), weight: 600, style: "normal" },
    { name: "Geist", data: await readFile(resolve(fontsDir, "Geist-Bold.ttf")), weight: 700, style: "normal" },
  ];

  await mkdir(ogDir, { recursive: true });

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
    console.log("gen-og: no snapshot — no per-motor cards generated");
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
    await writeFile(file, await render(motorCard(m, logoUri), geistFonts));
    written++;
    if (written % 100 === 0) console.log(`gen-og: ${written}/${motors.length} motor cards…`);
  }
  console.log(`gen-og: wrote ${written} per-motor cards under public/og/motor/`);
}

await main();
