// Tiny Upstash Redis REST client — just the handful of commands the alert
// system needs. Upstash's REST API takes the command as a path or JSON array and
// a bearer token; it works the same from any runtime over plain fetch.

// Accepts the AlertConfig (structurally) — just needs the Upstash URL + token.
type UpstashCfg = { upstashUrl: string; upstashToken: string };

async function cmd(cfg: UpstashCfg, args: (string | number)[]): Promise<unknown> {
  const res = await fetch(cfg.upstashUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.upstashToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`upstash ${args[0]} failed: ${res.status}`);
  }
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) throw new Error(`upstash ${args[0]} error: ${json.error}`);
  return json.result;
}

/** Add an email to a motor's subscriber set. */
export async function sadd(cfg: UpstashCfg, key: string, member: string): Promise<void> {
  await cmd(cfg, ["SADD", key, member]);
}

/** Remove an email from a motor's subscriber set. */
export async function srem(cfg: UpstashCfg, key: string, member: string): Promise<void> {
  await cmd(cfg, ["SREM", key, member]);
}

/** All emails subscribed to a motor. */
export async function smembers(cfg: UpstashCfg, key: string): Promise<string[]> {
  const r = await cmd(cfg, ["SMEMBERS", key]);
  return Array.isArray(r) ? (r as string[]) : [];
}

/** Set ``key`` to 1 only if absent, with a TTL; returns true if it was set
 * (i.e. we "claimed" it). Used for rate-limit and alert-cooldown guards. */
export async function setNxEx(cfg: UpstashCfg, key: string, ttlSeconds: number): Promise<boolean> {
  const r = await cmd(cfg, ["SET", key, "1", "NX", "EX", ttlSeconds]);
  return r === "OK";
}

/** Increment a counter and (re)set its TTL; returns the new value. Used for the
 * per-IP rate limit and the daily confirm-send cap. The EXPIRE runs on EVERY
 * call (not just the first) so a key can never get stuck without a TTL if an
 * earlier EXPIRE was missed — which would otherwise lock one IP out forever. The
 * window becomes sliding rather than fixed, which is only ever more restrictive
 * for an over-limit caller, so it's fine for a rate limit. */
export async function incrWithTtl(cfg: UpstashCfg, key: string, ttlSeconds: number): Promise<number> {
  const n = (await cmd(cfg, ["INCR", key])) as number;
  await cmd(cfg, ["EXPIRE", key, ttlSeconds]);
  return n;
}

/** Delete a key. Used to roll back an alert-cooldown claim when the email send
 * failed, so the next scrape run can retry instead of silently suppressing. */
export async function del(cfg: UpstashCfg, key: string): Promise<void> {
  await cmd(cfg, ["DEL", key]);
}

/** Iterate keys matching a glob with SCAN (cursor-based; never blocks Redis like
 * KEYS). Returns all matches. Used by the one-time reverse-index backfill. */
export async function scanKeys(cfg: UpstashCfg, match: string, count = 200): Promise<string[]> {
  const out: string[] = [];
  let cursor = "0";
  do {
    const r = (await cmd(cfg, ["SCAN", cursor, "MATCH", match, "COUNT", count])) as [string, string[]];
    cursor = Array.isArray(r) ? r[0] : "0";
    const batch = Array.isArray(r) && Array.isArray(r[1]) ? r[1] : [];
    out.push(...batch);
  } while (cursor !== "0");
  return out;
}
