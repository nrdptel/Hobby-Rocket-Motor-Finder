// Restock email-alert configuration + small pure helpers. All the alert state
// and email logic lives in TypeScript (these serverless routes) so there's one
// place to maintain it; the Python hourly scrape only computes which motors
// restocked and POSTs them to the dispatch route.
//
// Everything is gated on env vars: if alerts aren't configured, the routes
// return 503 and the UI hides the bell, so the site (and a fork) works exactly
// as before with zero setup.

export type AlertConfig = {
  resendApiKey: string;
  from: string; // e.g. "HPR Motor Finder <alerts@fusionspace.co>"
  upstashUrl: string;
  upstashToken: string;
  secret: string; // HMAC key for confirm/unsubscribe tokens
  dispatchSecret: string; // bearer secret the CI scrape uses to call /dispatch
  siteUrl: string;
};

/** Resolve the full alert config from env, or null if any required piece is
 * missing (→ alerts disabled). */
export function alertConfig(): AlertConfig | null {
  const resendApiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERTS_FROM;
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const secret = process.env.ALERTS_SECRET;
  const dispatchSecret = process.env.ALERTS_DISPATCH_SECRET;
  if (!resendApiKey || !from || !upstashUrl || !upstashToken || !secret || !dispatchSecret) {
    return null;
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://motor.fusionspace.co";
  return { resendApiKey, from, upstashUrl, upstashToken, secret, dispatchSecret, siteUrl };
}

/** Stable identity for a motor across scrape runs (ids are rebuilt every run).
 * MUST match the key the Python dispatcher builds from (manufacturer, designation). */
export function motorKey(manufacturer: string, designation: string): string {
  return `${manufacturer.trim()}::${designation.trim()}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize + validate an email; returns the lowercased address or null. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 3 || e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}
