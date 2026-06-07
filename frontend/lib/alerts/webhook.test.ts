import { describe, expect, it } from "vitest";

import { isRemovableEvent, recipientsFromEvent, verifyResendWebhook } from "./webhook";

const SECRET = "whsec_dGVzdHNlY3JldHRlc3RzZWNyZXQ="; // base64("testsecrettestsecret")

const b64dec = (s: string) => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
const b64enc = (u: Uint8Array) => {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
};

async function sign(secret: string, id: string, ts: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    b64dec(secret.slice("whsec_".length)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${payload}`)),
  );
  return `v1,${b64enc(sig)}`;
}

describe("verifyResendWebhook", () => {
  const id = "msg_1";
  const ts = "1700000000";
  const payload = '{"type":"email.bounced","data":{"to":["a@b.com"]}}';
  const now = 1700000000;

  it("accepts a valid signature within tolerance", async () => {
    const signature = await sign(SECRET, id, ts, payload);
    expect(await verifyResendWebhook({ secret: SECRET, id, timestamp: ts, signature, payload, now })).toBe(true);
  });

  it("rejects a tampered payload", async () => {
    const signature = await sign(SECRET, id, ts, payload);
    const tampered = payload.replace("a@b.com", "evil@x.com");
    expect(
      await verifyResendWebhook({ secret: SECRET, id, timestamp: ts, signature, payload: tampered, now }),
    ).toBe(false);
  });

  it("rejects a signature made with a different secret", async () => {
    const signature = await sign("whsec_b3RoZXJzZWNyZXRvdGhlcnNlY3JldA==", id, ts, payload);
    expect(await verifyResendWebhook({ secret: SECRET, id, timestamp: ts, signature, payload, now })).toBe(false);
  });

  it("rejects a stale timestamp (replay)", async () => {
    const signature = await sign(SECRET, id, ts, payload);
    expect(
      await verifyResendWebhook({ secret: SECRET, id, timestamp: ts, signature, payload, now: now + 10_000 }),
    ).toBe(false);
  });

  it("accepts when one of several space-delimited signatures matches", async () => {
    const good = await sign(SECRET, id, ts, payload);
    const signature = `v1,AAAA ${good}`;
    expect(await verifyResendWebhook({ secret: SECRET, id, timestamp: ts, signature, payload, now })).toBe(true);
  });

  it("rejects missing headers", async () => {
    expect(await verifyResendWebhook({ secret: SECRET, id: null, timestamp: ts, signature: "x", payload, now })).toBe(false);
  });
});

describe("recipientsFromEvent", () => {
  it("reads an array or a string `to`", () => {
    expect(recipientsFromEvent({ data: { to: ["a@b.com", "c@d.com"] } })).toEqual(["a@b.com", "c@d.com"]);
    expect(recipientsFromEvent({ data: { to: "a@b.com" } })).toEqual(["a@b.com"]);
    expect(recipientsFromEvent({ data: {} })).toEqual([]);
    expect(recipientsFromEvent(null)).toEqual([]);
  });
});

describe("isRemovableEvent", () => {
  it("removes on complaints and permanent bounces, not transient/delivered", () => {
    expect(isRemovableEvent({ type: "email.complained" })).toBe(true);
    expect(isRemovableEvent({ type: "email.bounced", data: { bounce: { type: "Permanent" } } })).toBe(true);
    expect(isRemovableEvent({ type: "email.bounced" })).toBe(true); // unknown → treat as hard
    expect(isRemovableEvent({ type: "email.bounced", data: { bounce: { type: "Transient" } } })).toBe(false);
    expect(isRemovableEvent({ type: "email.delivered" })).toBe(false);
    expect(isRemovableEvent({})).toBe(false);
  });
});
