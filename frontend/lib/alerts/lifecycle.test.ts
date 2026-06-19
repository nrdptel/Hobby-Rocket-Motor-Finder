import { beforeEach, describe, expect, it, vi } from "vitest";

// End-to-end exercise of the subscribe → confirm → unsubscribe flow through the
// real route handlers. Only the two I/O edges are faked: the Upstash REST client
// (an in-memory store) and the email send (captured, so we can follow the
// confirm link exactly as a user would). Validation, the three-layer rate limit,
// token sign/verify, and the Redis-key mutations all run for real — so this is
// the one test that proves the primitives work *together*, not just in isolation.

// --- in-memory Redis, shared by the routes AND the real rate-limiter ----------
const redis = vi.hoisted(() => {
  type Entry = { set?: Set<string>; str?: string };
  let store = new Map<string, Entry>();
  return {
    reset() {
      store = new Map();
    },
    members(key: string): string[] {
      return [...(store.get(key)?.set ?? [])];
    },
    async sadd(_c: unknown, key: string, member: string) {
      const e = store.get(key) ?? {};
      (e.set ??= new Set()).add(member);
      store.set(key, e);
    },
    async srem(_c: unknown, key: string, member: string) {
      store.get(key)?.set?.delete(member);
    },
    async smembers(_c: unknown, key: string) {
      return [...(store.get(key)?.set ?? [])];
    },
    async setNxEx(_c: unknown, key: string) {
      if (store.has(key)) return false;
      store.set(key, { str: "1" });
      return true;
    },
    async incrWithTtl(_c: unknown, key: string) {
      const n = Number(store.get(key)?.str ?? "0") + 1;
      store.set(key, { str: String(n) });
      return n;
    },
    async del(_c: unknown, key: string) {
      store.delete(key);
    },
    async ttl(_c: unknown, key: string) {
      return store.has(key) ? 600 : -2;
    },
    async scanKeys(_c: unknown) {
      return [...store.keys()];
    },
  };
});

vi.mock("@/lib/alerts/upstash", () => ({
  sadd: redis.sadd,
  srem: redis.srem,
  smembers: redis.smembers,
  setNxEx: redis.setNxEx,
  incrWithTtl: redis.incrWithTtl,
  del: redis.del,
  ttl: redis.ttl,
  scanKeys: redis.scanKeys,
}));

// --- captured outbound email --------------------------------------------------
const mail = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/alerts/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alerts/email")>();
  return {
    ...actual,
    sendEmail: (async (args: Record<string, unknown>) => {
      mail.sent.push(args);
    }) as unknown as typeof actual.sendEmail,
  };
});

import { motorKey, subKey, userMotorsKey } from "@/lib/alerts/config";
import { signToken } from "@/lib/alerts/tokens";
import {
  handleSubscribe,
  handleConfirm,
  handleUnsubscribe,
} from "@/lib/alerts/handlers";

// The route handlers now live in lib/alerts/handlers.ts (moved out of the Next
// app so they can run as Cloudflare Pages Functions under static export). They
// take (request, env); on Node we pass process.env, matching production Next.
const subscribe = (req: Request) => handleSubscribe(req, process.env);
const confirm = (req: Request) => handleConfirm(req, process.env);
const unsubscribe = (req: Request) => handleUnsubscribe(req, process.env);

const SECRET = "integration-secret";
const MFR = "AeroTech";
const DES = "H128W";
const KEY = motorKey(MFR, DES);

const subscribeReq = (body: object, ip = "1.2.3.4") =>
  new Request("https://site.test/api/alerts/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });

// Pull the confirm URL out of the captured email, exactly as a recipient would
// click it (token is URL-encoded; the confirm route decodes it).
const lastConfirmUrl = (): string => {
  const text = String(mail.sent.at(-1)?.text ?? "");
  const m = text.match(/https:\/\/\S+\/api\/alerts\/confirm\?token=\S+/);
  if (!m) throw new Error("no confirm URL in the sent email");
  return m[0];
};

beforeEach(() => {
  redis.reset();
  mail.sent.length = 0;
  process.env.ZEPTOMAIL_TOKEN = "zt";
  process.env.ALERTS_FROM = "HPR Motor Finder <alerts@example.test>";
  process.env.UPSTASH_REDIS_REST_URL = "https://upstash.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "ut";
  process.env.ALERTS_SECRET = SECRET;
  process.env.ALERTS_DISPATCH_SECRET = "dispatch-secret";
  process.env.NEXT_PUBLIC_SITE_URL = "https://site.test";
});

describe("alert subscribe → confirm → unsubscribe lifecycle", () => {
  it("walks the full happy path and mutates the store correctly", async () => {
    const email = "alice@example.com";

    // 1. Subscribe → one confirmation email, but NOT yet a subscriber.
    const sub = await subscribe(subscribeReq({ email, manufacturer: MFR, designation: DES }));
    expect(sub.status).toBe(200);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(email);
    expect(redis.members(subKey(KEY))).not.toContain(email);

    // 2. Click the confirm link from the email.
    const ok = await confirm(new Request(lastConfirmUrl()));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toMatch(/subscribed/i);
    // Forward set (dispatch reads this) + reverse index (manage page reads this).
    expect(redis.members(subKey(KEY))).toContain(email);
    expect(redis.members(userMotorsKey(email))).toContain(KEY);

    // 3. Unsubscribe via a token shaped exactly like the one dispatch emails.
    const unsubToken = await signToken(SECRET, { t: "u", e: email, m: KEY, x: 0 });
    const off = await unsubscribe(
      new Request(`https://site.test/api/alerts/unsubscribe?token=${encodeURIComponent(unsubToken)}`),
    );
    expect(off.status).toBe(200);
    expect(await off.text()).toMatch(/unsubscribed/i);
    expect(redis.members(subKey(KEY))).not.toContain(email);
  });

  it("suppresses a second confirmation to the same address+motor (anti email-bomb)", async () => {
    const email = "victim@example.com";
    const body = { email, manufacturer: MFR, designation: DES };

    const first = await subscribe(subscribeReq(body));
    const second = await subscribe(subscribeReq(body));

    // Both succeed (we never reveal subscription state), but only one email goes
    // out — the per-recipient cooldown blocks the repeat send.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mail.sent).toHaveLength(1);
  });

  it("enforces the per-IP hourly cap (12) and then 429s", async () => {
    // Distinct recipients (so the per-recipient cooldown never trips) from one IP.
    for (let i = 0; i < 12; i++) {
      const res = await subscribe(
        subscribeReq({ email: `user${i}@example.com`, manufacturer: MFR, designation: DES }),
      );
      expect(res.status).toBe(200);
    }
    const blocked = await subscribe(
      subscribeReq({ email: "user12@example.com", manufacturer: MFR, designation: DES }),
    );
    expect(blocked.status).toBe(429);
    expect(mail.sent).toHaveLength(12);
  });

  it("rejects an invalid email with 400 before any send", async () => {
    const res = await subscribe(subscribeReq({ email: "not-an-email", manufacturer: MFR, designation: DES }));
    expect(res.status).toBe(400);
    expect(mail.sent).toHaveLength(0);
  });

  it("returns 503 when alerts aren't configured", async () => {
    delete process.env.ALERTS_SECRET;
    const res = await subscribe(subscribeReq({ email: "a@b.com", manufacturer: MFR, designation: DES }));
    expect(res.status).toBe(503);
    expect(mail.sent).toHaveLength(0);
  });

  it("confirm rejects a tampered/garbage token", async () => {
    const res = await confirm(new Request("https://site.test/api/alerts/confirm?token=garbage.garbage"));
    expect(res.status).toBe(400);
    expect(redis.members(subKey(KEY))).toHaveLength(0);
  });

  it("enforces token scope across routes (confirm token can't unsubscribe, and vice-versa)", async () => {
    const email = "scope@example.com";
    await subscribe(subscribeReq({ email, manufacturer: MFR, designation: DES }));
    const confirmUrl = lastConfirmUrl();
    const confirmToken = new URL(confirmUrl).searchParams.get("token")!;

    // A confirm (t:"c") token presented to the unsubscribe route is rejected.
    const asUnsub = await unsubscribe(
      new Request(`https://site.test/api/alerts/unsubscribe?token=${encodeURIComponent(confirmToken)}`),
    );
    expect(asUnsub.status).toBe(400);

    // An unsubscribe (t:"u") token presented to the confirm route is rejected.
    const unsubToken = await signToken(SECRET, { t: "u", e: email, m: KEY, x: 0 });
    const asConfirm = await confirm(
      new Request(`https://site.test/api/alerts/confirm?token=${encodeURIComponent(unsubToken)}`),
    );
    expect(asConfirm.status).toBe(400);
    // Neither misuse mutated the subscriber set.
    expect(redis.members(subKey(KEY))).not.toContain(email);
  });
});
