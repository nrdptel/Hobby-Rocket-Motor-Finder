import { ImageResponse } from "next/og";

// Next picks up `opengraph-image.tsx` (and `twitter-image.tsx`) by file-system
// convention and serves it at /opengraph-image. The Metadata API in layout.tsx
// then references it automatically, so we don't need to specify the image URL
// explicitly. A single file covers both OG and Twitter previews.

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "HPR Motor Finder — U.S. high-power rocketry motor availability";

export default async function Image() {
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
        }}
      >
        <div
          style={{
            fontSize: 28,
            color: "#a1a1aa",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            marginBottom: 24,
          }}
        >
          U.S. high-power rocketry
        </div>
        <div
          style={{
            fontSize: 96,
            fontWeight: 700,
            lineHeight: 1.05,
            marginBottom: 32,
            letterSpacing: "-0.02em",
          }}
        >
          HPR Motor Finder
        </div>
        <div
          style={{
            fontSize: 36,
            color: "#d4d4d8",
            lineHeight: 1.3,
            maxWidth: 980,
          }}
        >
          AeroTech motor stock + pricing aggregated across vendors, in one searchable view.
        </div>
      </div>
    ),
    { ...size },
  );
}
