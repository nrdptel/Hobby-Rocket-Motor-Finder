// Restock email-alert configuration + small pure helpers. All the alert state
// and email logic lives in TypeScript (these serverless routes) so there's one
// place to maintain it; the Python hourly scrape only computes which motors
// restocked and POSTs them to the dispatch route.
//
// Everything is gated on env vars: if alerts aren't configured, the routes
// return 503 and the UI hides the bell, so the site (and a fork) works exactly
// as before with zero setup.

export type AlertConfig = {
  // Amazon SES sending credentials. Env vars use an SES_ prefix (not AWS_) because
  // Vercel runs functions on Lambda, which reserves the AWS_ prefix.
  ses: { region: string; accessKeyId: string; secretAccessKey: string };
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
  const region = process.env.SES_REGION;
  const accessKeyId = process.env.SES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SES_SECRET_ACCESS_KEY;
  const from = process.env.ALERTS_FROM;
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const secret = process.env.ALERTS_SECRET;
  const dispatchSecret = process.env.ALERTS_DISPATCH_SECRET;
  if (
    !region || !accessKeyId || !secretAccessKey ||
    !from || !upstashUrl || !upstashToken || !secret || !dispatchSecret
  ) {
    return null;
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://motor.fusionspace.co";
  return {
    ses: { region, accessKeyId, secretAccessKey },
    from, upstashUrl, upstashToken, secret, dispatchSecret, siteUrl,
  };
}

/** Stable identity for a motor across scrape runs (ids are rebuilt every run).
 * MUST match the key the Python dispatcher builds from (manufacturer, designation). */
export function motorKey(manufacturer: string, designation: string): string {
  return `${manufacturer.trim()}::${designation.trim()}`;
}

/** Redis key for a motor's subscriber set (email members). */
export function subKey(motorKey: string): string {
  return `sub:${motorKey}`;
}

/** Redis key for the reverse index: the set of motorKeys an email subscribed to.
 * Lets the magic-link manage page list a user's subscriptions. Emails already
 * live in Upstash (as subscriber-set members), so keying on email adds no leak —
 * and the store is private behind a token. */
export function userMotorsKey(email: string): string {
  return `umotors:${email}`;
}

/** Redis key for the global set of every confirmed rocket-fit subscription
 * (member = canonical rocket-sub JSON). The dispatch route iterates these to
 * find which subscribers a restocked motor fits. */
export function rocketSubsKey(): string {
  return "rocketsubs";
}

/** Redis key for one email's rocket-fit subscriptions (same members as the
 * global set) — powers the manage page's rocket section. */
export function userRocketsKey(email: string): string {
  return `urockets:${email}`;
}

/** The trusted client IP for rate limiting. The leftmost `x-forwarded-for`
 * entry is client-supplied and spoofable on Vercel (the platform appends the
 * real edge IP rather than replacing the header), so a per-request spoof would
 * defeat the limiter. Prefer the Vercel-set headers, which the client can't
 * forge; fall back to XFF only off-platform (local/dev). */
export function clientIp(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  const xff = request.headers.get("x-forwarded-for");
  return xff ? xff.split(",")[0].trim() : "unknown";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize + validate an email; returns the lowercased address or null. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 3 || e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}
