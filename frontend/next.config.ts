import type { NextConfig } from "next";

// Static export for Cloudflare Pages. `output: "export"` prerenders every route
// to static HTML in `out/` at build time (the bundled snapshot is read via fs at
// BUILD time, which is fine); there is no Node server at runtime. Dynamic
// behavior that needed a runtime server moved out: the alert API routes are now
// Cloudflare Pages Functions (functions/api/alerts/*), the compare page renders
// client-side, and OG images are pre-generated.
//
// `images.unoptimized` is required by static export (no Image Optimization
// server). The security headers that lived in `headers()` move to public/_headers
// (static export can't emit response headers; Cloudflare Pages serves _headers).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
