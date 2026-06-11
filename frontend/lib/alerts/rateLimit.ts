// Abuse limits for the public alert endpoints. Three layers:
//   1. per-IP hourly cap (keyed on the TRUSTED client IP — see config.clientIp)
//   2. per-RECIPIENT cooldown: the same address can't be re-mailed a
//      confirmation within a short window. The confirmation goes to an address
//      the requester hasn't proven they control, so without this the endpoint is
//      an email-bomb vector (spam a victim's inbox from our domain, trashing our
//      sender reputation right at launch).
//   3. a global HOURLY cap on confirmation-email sends — a backstop against a
//      runaway/abuse burst. Hourly (not daily) on purpose: the old daily cap, once
//      tripped, locked out EVERY legitimate signup for the rest of the UTC day,
//      so a launch surge of real signups (or one attacker) could DoS the whole
//      feature. An hourly window self-heals within the hour.

import type { AlertConfig } from "./config";
import { del, incrWithTtl, setNxEx, ttl } from "./upstash";

// Generous enough for a launch-day surge of genuine signups, low enough to bound
// a runaway. Dispatch (restock) sends are separate and not counted here.
const GLOBAL_CONFIRM_CAP_PER_HOUR = 300;

// One confirmation per (address, target) per window. Keyed on the SPECIFIC
// motor/rocket, not the address alone, so a real user can bell several motors in
// a row while a repeat for the same target (a retry, or an inbox-bomb on one
// motor) is still deduped. Cross-target bombing is bounded by the per-IP and
// global caps — those are the real anti-abuse controls.
const EMAIL_CONFIRM_COOLDOWN_S = 600; // 10 min

/** Result of a rate-limit check. `retryAfterS` is meaningful only when `limited`
 * is true — seconds until the window resets, for a Retry-After hint. */
export type RateCheck = { limited: boolean; retryAfterS: number };

/** Remaining seconds on a window key, falling back to the full window when the
 * key has no TTL / doesn't exist (Redis TTL returns -1 / -2). */
async function retryAfter(cfg: AlertConfig, key: string, windowSeconds: number): Promise<number> {
  const t = await ttl(cfg, key);
  return t > 0 ? t : windowSeconds;
}

/** Per-IP hourly limit. When limited, `retryAfterS` is the key's remaining TTL.
 * Throws if the store is unavailable (caller decides fail-open vs fail-closed). */
export async function overIpLimit(
  cfg: AlertConfig,
  keyPrefix: string,
  ip: string,
  max: number,
  windowSeconds = 3600,
): Promise<RateCheck> {
  const key = `${keyPrefix}:${ip}`;
  const n = await incrWithTtl(cfg, key, windowSeconds);
  if (n <= max) return { limited: false, retryAfterS: 0 };
  return { limited: true, retryAfterS: await retryAfter(cfg, key, windowSeconds) };
}

/** Claim the per-recipient confirmation cooldown for `email`. Returns true when a
 * confirmation was ALREADY sent to this address within the window (so the caller
 * should skip the send and return the normal success message — never re-mailing
 * an address on demand). Throws if the store is unavailable. */
export async function confirmRecentlySent(
  cfg: AlertConfig,
  email: string,
  target: string,
): Promise<boolean> {
  // setNxEx returns true when the key was newly set (first send), false when it
  // already exists (a recent send) — so a failed claim means "already sent".
  const claimed = await setNxEx(cfg, cooldownKey(email, target), EMAIL_CONFIRM_COOLDOWN_S);
  return !claimed;
}

/** Release the per-recipient cooldown claimed by {@link confirmRecentlySent}.
 * Call this when the confirmation send then FAILS, so a transient send error
 * doesn't lock a legitimate address out for the whole window. Best-effort. */
export async function releaseConfirmCooldown(
  cfg: AlertConfig,
  email: string,
  target: string,
): Promise<void> {
  try {
    await del(cfg, cooldownKey(email, target));
  } catch {
    /* best-effort — the cooldown will lapse on its own TTL */
  }
}

/** Cooldown key for an (email, target) pair — `target` is the motorKey or rocket
 * spec being subscribed to, so different motors don't share one address-wide
 * lock. */
function cooldownKey(email: string, target: string): string {
  return `csent:${email}:${target}`;
}

/** Global hourly cap on confirmation-email sends. When limited, `retryAfterS` is
 * the bucket's remaining TTL. `hour` is an injected YYYY-MM-DDTHH string (keeps
 * this testable and avoids a clock dependency in the helper). */
export async function overGlobalConfirmCap(cfg: AlertConfig, hour: string): Promise<RateCheck> {
  const key = `csend:${hour}`;
  const n = await incrWithTtl(cfg, key, 3700); // ~1h + slack TTL
  if (n <= GLOBAL_CONFIRM_CAP_PER_HOUR) return { limited: false, retryAfterS: 0 };
  return { limited: true, retryAfterS: await retryAfter(cfg, key, 3600) };
}

/** The current UTC hour as YYYY-MM-DDTHH, for the global-cap key. */
export function utcHour(): string {
  return new Date().toISOString().slice(0, 13);
}

/** Human-friendly "try again in …" phrase for a Retry-After number of seconds. */
export function formatRetry(seconds: number): string {
  if (seconds <= 60) return "less than a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes >= 55) return "about an hour";
  return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** A 429 response carrying a friendly, time-aware message, a machine-readable
 * `retryAfterS`, and the standard `Retry-After` header. `note` is appended to the
 * default sentence (e.g. to reassure that earlier confirmations already sent). */
export function rateLimitedResponse(retryAfterS: number, note?: string): Response {
  const error =
    `You're going a bit fast — please try again in ${formatRetry(retryAfterS)}.` +
    (note ? ` ${note}` : "");
  return new Response(JSON.stringify({ error, retryAfterS }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfterS) },
  });
}
