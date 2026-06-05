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

/** Increment a counter, setting a TTL on first use; returns the new value.
 * Used for a simple per-IP subscribe rate limit. */
export async function incrWithTtl(cfg: UpstashCfg, key: string, ttlSeconds: number): Promise<number> {
  const n = (await cmd(cfg, ["INCR", key])) as number;
  if (n === 1) await cmd(cfg, ["EXPIRE", key, ttlSeconds]);
  return n;
}
