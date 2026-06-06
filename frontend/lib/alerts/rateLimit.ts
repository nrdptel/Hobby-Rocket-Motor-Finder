// Abuse limits for the public alert endpoints. Two layers:
//   1. per-IP hourly cap (keyed on the TRUSTED client IP — see config.clientIp)
//   2. a global daily cap on confirmation-email sends, so even if the per-IP
//      layer is somehow evaded an attacker can't burn the whole Resend free-tier
//      quota (which would DoS real restock alerts) or email-bomb at scale.

import type { AlertConfig } from "./config";
import { incrWithTtl } from "./upstash";

// Comfortably above any real hobby-scale signup volume, low enough to bound
// abuse and stay well under Resend's 100/day free tier (restock dispatch sends
// are separate and not counted here).
const DAILY_CONFIRM_CAP = 50;

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

/** Global daily cap on confirmation-email sends. Returns true if today's cap is
 * already reached. `day` is an injected YYYY-MM-DD string (keeps this testable
 * and avoids a clock dependency in the helper). */
export async function overDailyConfirmCap(cfg: AlertConfig, day: string): Promise<boolean> {
  const n = await incrWithTtl(cfg, `csend:${day}`, 90_000); // ~25h TTL
  return n > DAILY_CONFIRM_CAP;
}

/** Today as YYYY-MM-DD (UTC) for the daily-cap key. */
export function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}
