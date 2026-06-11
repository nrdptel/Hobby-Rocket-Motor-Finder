import { describe, expect, it } from "vitest";

import { isRemovableEvent, recipientsFromEvent, verifyZeptoWebhook } from "./webhook";

const SECRET = "testsecrettestsecret";

const b64enc = (u: Uint8Array) => {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
};

/** Build a valid `producer-signature` header for a body — mirrors the scheme in
 * webhook.ts (HMAC-SHA256 over `<ts>.<body>`, ts in epoch millis). */
async function sign(secret: string, tsMs: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${tsMs}.${payload}`)),
  );
  return `ts=${tsMs};s=${b64enc(sig)};s-algorithm=HmacSHA256`;
}

describe("verifyZeptoWebhook", () => {
  const tsMs = "1700000000000"; // epoch millis
  const now = 1700000000; // same instant in seconds
  const payload = '{"event_name":"hard bounce","event_message":[{"email_info":{"to":[{"email_address":{"address":"a@b.com"}}]}}]}';

  it("accepts a valid signature within tolerance", async () => {
    const header = await sign(SECRET, tsMs, payload);
    expect(await verifyZeptoWebhook({ secret: SECRET, signatureHeader: header, payload, now })).toBe(true);
  });

  it("rejects a tampered payload", async () => {
    const header = await sign(SECRET, tsMs, payload);
    const tampered = payload.replace("a@b.com", "evil@x.com");
    expect(
      await verifyZeptoWebhook({ secret: SECRET, signatureHeader: header, payload: tampered, now }),
    ).toBe(false);
  });

  it("rejects a signature made with a different secret", async () => {
    const header = await sign("othersecretothersecret", tsMs, payload);
    expect(await verifyZeptoWebhook({ secret: SECRET, signatureHeader: header, payload, now })).toBe(false);
  });

  it("rejects a stale timestamp (replay)", async () => {
    const header = await sign(SECRET, tsMs, payload);
    expect(
      await verifyZeptoWebhook({ secret: SECRET, signatureHeader: header, payload, now: now + 10_000 }),
    ).toBe(false);
  });

  it("tolerates whitespace and key ordering in the header", async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const s = b64enc(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${tsMs}.${payload}`))),
    );
    const header = ` s-algorithm=HmacSHA256 ; ts=${tsMs} ; s=${s} `;
    expect(await verifyZeptoWebhook({ secret: SECRET, signatureHeader: header, payload, now })).toBe(true);
  });

  it("rejects a missing or malformed header", async () => {
    expect(await verifyZeptoWebhook({ secret: SECRET, signatureHeader: null, payload, now })).toBe(false);
    expect(await verifyZeptoWebhook({ secret: SECRET, signatureHeader: "garbage", payload, now })).toBe(false);
  });
});

describe("recipientsFromEvent", () => {
  it("extracts nested recipients and ignores non-recipient addresses", () => {
    const event = {
      event_name: "hard bounce",
      event_message: [
        {
          email_info: {
            from: { address: "alerts@fusionspace.co" }, // must NOT be scrubbed
            to: [{ email_address: { address: "a@b.com" } }, { email_address: { address: "c@d.com" } }],
          },
        },
      ],
    };
    expect(recipientsFromEvent(event).sort()).toEqual(["a@b.com", "c@d.com"]);
  });

  it("handles a single (non-array) email_message/to and de-dupes", () => {
    const event = {
      event_message: { email_info: { to: { email_address: { address: "a@b.com" } } } },
    };
    expect(recipientsFromEvent(event)).toEqual(["a@b.com"]);
    expect(recipientsFromEvent(null)).toEqual([]);
    expect(recipientsFromEvent({})).toEqual([]);
  });
});

describe("isRemovableEvent", () => {
  it("removes on hard bounce and feedback-loop, not soft/other", () => {
    expect(isRemovableEvent({ event_name: "hard bounce" })).toBe(true);
    expect(isRemovableEvent({ event_name: "hardbounce" })).toBe(true);
    expect(isRemovableEvent({ event_name: "feedback loop" })).toBe(true);
    expect(isRemovableEvent({ event_name: "spam complaint" })).toBe(true);
    expect(isRemovableEvent({ event_name: "soft bounce" })).toBe(false);
    expect(isRemovableEvent({ event_name: "email opens" })).toBe(false);
    expect(isRemovableEvent({})).toBe(false);
  });
});
