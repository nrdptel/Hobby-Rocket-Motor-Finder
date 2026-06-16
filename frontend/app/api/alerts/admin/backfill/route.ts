import { alertConfig, userMotorsKey } from "@/lib/alerts/config";
import { hasDispatchBearer, json } from "@/lib/alerts/http";
import { sadd, scanKeys, smembers } from "@/lib/alerts/upstash";

export const dynamic = "force-dynamic";

// One-time maintenance: subscriptions created before PR #50 wrote only the
// forward set (sub:<motorKey>) and not the per-email reverse index
// (umotors:<email>), so they're invisible to the manage page / unsubscribe-all.
// This scans every forward motor-subscriber set and backfills the reverse index.
// Idempotent (SADD), so it's safe to run more than once. Auth = the dispatch
// bearer secret (same trust level as the dispatch endpoint). Rocket subs need no
// backfill: they only exist post-#50 and were always dual-written.
export async function POST(request: Request): Promise<Response> {
  const cfg = alertConfig();
  if (!cfg) return json({ error: "alerts not configured" }, 503);

  if (!hasDispatchBearer(request, cfg)) {
    return json({ error: "unauthorized" }, 401);
  }

  let keysScanned = 0;
  let backfilled = 0;
  try {
    const keys = await scanKeys(cfg, "sub:*");
    for (const key of keys) {
      keysScanned++;
      const motorKey = key.slice("sub:".length);
      const emails = await smembers(cfg, key);
      for (const email of emails) {
        await sadd(cfg, userMotorsKey(email), motorKey);
        backfilled++;
      }
    }
  } catch (e) {
    return json({ error: `backfill failed: ${(e as Error).message}` }, 500);
  }
  return json({ ok: true, keysScanned, backfilled });
}
