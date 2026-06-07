import type { NextConfig } from "next";

// Baseline security headers for every response. Vercel already sets HSTS; these
// cover clickjacking, MIME sniffing, and referrer leakage. The Referrer-Policy
// in particular means only the origin (never a full URL with a manage/unsub
// token) is sent when a user clicks an outbound link from an alert page.
// A full CSP is intentionally omitted: the inline theme-init script in layout.tsx
// would need a per-request nonce/hash, and a misconfigured CSP failing closed
// mid-launch is a worse risk than its marginal benefit here.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
