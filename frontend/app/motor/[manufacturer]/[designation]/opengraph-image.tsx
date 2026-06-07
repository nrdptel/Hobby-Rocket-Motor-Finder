import { ImageResponse } from "next/og";

import { loadSnapshot } from "@/lib/snapshot";
import {
  MIN_CLASS,
  cheapestInStockListing,
  designationFromSlug,
  formatImpulse,
  formatPrice,
  formatThrust,
  listingInStock,
  manufacturerLabel,
  manufacturerSlug,
} from "@/lib/derive";
import { OG_LOGO_PNG } from "@/lib/og-logo";

// Per-motor social card: shared links to /motor/<mfr>/<designation> unfurl with
// the motor's specs + live stock instead of the generic site card. Mirrors the
// styling of the root opengraph-image.

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Motor availability — HPR Motor Finder";

export default async function Image({
  params,
}: {
  params: Promise<{ manufacturer: string; designation: string }>;
}) {
  const p = await params;
  const snapshot = await loadSnapshot();
  const designation = designationFromSlug(p.designation);
  const mfr = p.manufacturer.toLowerCase();
  const motor = snapshot?.motors.find(
    (m) =>
      m.listings.length > 0 &&
      m.impulse_class >= MIN_CLASS &&
      manufacturerSlug(m.manufacturer) === mfr &&
      m.designation === designation,
  );

  // Fall back to a generic card if the motor can't be resolved (renamed/removed).
  const heading = motor ? motor.designation : "HPR Motor Finder";
  const subhead = motor
    ? `${manufacturerLabel(motor.manufacturer)} · ${motor.impulse_class}-class · ${motor.diameter_mm}mm${
        motor.propellant ? ` · ${motor.propellant}` : ""
      }`
    : "U.S. high-power rocketry motor availability";
  const specLine = motor
    ? `${formatImpulse(motor.total_impulse_ns)}  ·  ${formatThrust(motor.avg_thrust_n)} avg`
    : "";

  let stockLine = "";
  let inStock = false;
  if (motor) {
    const n = motor.listings.filter((l) => listingInStock(l.status)).length;
    inStock = n > 0;
    const vendors = motor.listings.length;
    if (n > 0) {
      const cheapest = cheapestInStockListing(motor);
      const price =
        cheapest?.price_cents != null
          ? ` — from ${formatPrice(cheapest.price_cents, cheapest.currency)}`
          : "";
      stockLine = `In stock at ${n} of ${vendors} vendor${vendors === 1 ? "" : "s"}${price}`;
    } else {
      stockLine = `Sold out at all ${vendors} tracked vendor${vendors === 1 ? "" : "s"}`;
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
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
        }}
      >
        <div
          style={{
            fontSize: 30,
            color: "#a1a1aa",
            letterSpacing: "0.02em",
            marginBottom: 20,
          }}
        >
          {subhead}
        </div>
        <div
          style={{
            fontSize: 120,
            fontWeight: 700,
            lineHeight: 1.0,
            marginBottom: 28,
            letterSpacing: "-0.02em",
          }}
        >
          {heading}
        </div>
        {specLine && (
          <div style={{ fontSize: 40, color: "#d4d4d8", marginBottom: 28 }}>{specLine}</div>
        )}
        {stockLine && (
          <div
            style={{
              fontSize: 38,
              fontWeight: 600,
              color: inStock ? "#34d399" : "#a1a1aa",
            }}
          >
            {stockLine}
          </div>
        )}
        <div
          style={{
            position: "absolute",
            bottom: 58,
            left: 80,
            display: "flex",
            alignItems: "center",
            gap: 18,
            opacity: 0.85,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={OG_LOGO_PNG} width={233} height={52} alt="Fusion Space" />
          <span style={{ fontSize: 26, color: "#a1a1aa", letterSpacing: "0.04em" }}>
            motor.fusionspace.co
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
