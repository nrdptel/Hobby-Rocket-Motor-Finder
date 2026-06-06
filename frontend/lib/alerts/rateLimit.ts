// Abuse limits for the public alert endpoints. Three layers:
//   1. per-IP hourly cap (keyed on the TRUSTED client IP — see config.clientIp)
//   2. per-RECIPIENT cooldown: the same address can't be re-mailed a
//      confirmation within a short window. The confirmation goes to an address
//      the requester hasn't proven they control, so without this the endpoint is
//      an email-bomb vector (spam a victim's inbox from our domain, trashing SES
//      reputation right at launch).
//   3. a global HOURLY cap on confirmation-email sends — a backstop against a
//      runaway/abuse burst. Hourly (not daily) on purpose: the old daily cap, once
//      tripped, locked out EVERY legitimate signup for the rest of the UTC day,
//      so a launch surge of real signups (or one attacker) could DoS the whole
//      feature. An hourly window self-heals within the hour.

import type { AlertConfig } from "./config";
import { del, incrWithTtl, setNxEx } from "./upstash";

// Generous enough for a launch-day surge of genuine signups, low enough to bound
// a runaway. Dispatch (restock) sends are separate and not counted here.
const GLOBAL_CONFIRM_CAP_PER_HOUR = 300;

// One confirmation per address per window. Long enough to stop inbox-bombing,
// short enough that a real user who mis-typed and retries isn't stuck for long.
const EMAIL_CONFIRM_COOLDOWN_S = 600; // 10 min

/** Per-IP hourly limit. Returns true if the caller is over the cap. Throws if
 * the store is unavailable (caller decides fail-open vs fail-closed). */
export async function overIpLimit(
  cfg: AlertConfig,
  keyPrefix: string,
  ip: string,
  max: number,
  windowSeconds = 3600,
): Promise<boolean> {
  const n = await incrWithTtl(cfg, `${keyPrefix}:${ip}`, windowSeconds);
  return n > max;
}

/** Claim the per-recipient confirmation cooldown for `email`. Returns true when a
 * confirmation was ALREADY sent to this address within the window (so the caller
 * should skip the send and return the normal success message — never re-mailing
 * an address on demand). Throws if the store is unavailable. */
export async function confirmRecentlySent(cfg: AlertConfig, email: string): Promise<boolean> {
  // setNxEx returns true when the key was newly set (first send), false when it
  // already exists (a recent send) — so a failed claim means "already sent".
  const claimed = await setNxEx(cfg, `csent:${email}`, EMAIL_CONFIRM_COOLDOWN_S);
  return !claimed;
}

/** Release the per-recipient cooldown claimed by {@link confirmRecentlySent}.
 * Call this when the confirmation send then FAILS, so a transient send error
 * doesn't lock a legitimate address out for the whole window. Best-effort. */
export async function releaseConfirmCooldown(cfg: AlertConfig, email: string): Promise<void> {
  try {
    await del(cfg, `csent:${email}`);
  } catch {
    /* best-effort — the cooldown will lapse on its own TTL */
  }
}

/** Global hourly cap on confirmation-email sends. Returns true if this hour's cap
 * is already reached. `hour` is an injected YYYY-MM-DDTHH string (keeps this
 * testable and avoids a clock dependency in the helper). */
export async function overGlobalConfirmCap(cfg: AlertConfig, hour: string): Promise<boolean> {
  const n = await incrWithTtl(cfg, `csend:${hour}`, 3700); // ~1h + slack TTL
  return n > GLOBAL_CONFIRM_CAP_PER_HOUR;
}

/** The current UTC hour as YYYY-MM-DDTHH, for the global-cap key. */
export function utcHour(): string {
  return new Date().toISOString().slice(0, 13);
}
