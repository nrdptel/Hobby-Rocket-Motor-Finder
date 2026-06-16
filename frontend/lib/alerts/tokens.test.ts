import { afterEach, describe, expect, it, vi } from "vitest";

import { signToken, verifyToken, type TokenPayload } from "./tokens";

// The signed-token primitive is the entire trust model for confirm /
// unsubscribe / manage links: there is no DB row, so the HMAC signature is the
// only thing standing between a forged URL and a state change. These tests pin
// the security-relevant behaviours so a refactor can't quietly weaken them.

const SECRET = "test-secret-please-ignore-32-bytes!!";

const base = (over: Partial<TokenPayload> = {}): TokenPayload => ({
  t: "c",
  e: "alice@example.com",
  m: "AeroTech::H128W",
  x: 0,
  ...over,
});

// Flip one char in the middle of a base64url segment to a different valid char,
// so the string stays the same length / decodable but the bytes differ.
function flipChar(s: string): string {
  const i = Math.floor(s.length / 2);
  return s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
}

describe("signToken / verifyToken", () => {
  afterEach(() => vi.useRealTimers());

  it("round-trips every token type back to the original payload", async () => {
    for (const t of ["c", "u", "m", "rc", "ru"] as const) {
      const p = base({ t });
      const got = await verifyToken(SECRET, await signToken(SECRET, p));
      expect(got).toEqual(p);
    }
  });

  it("preserves the type field so a confirm token can't read as an unsubscribe", async () => {
    // Routes gate on payload.t (confirm accepts c/rc; unsubscribe accepts u/ru).
    // That separation only holds if verify returns the type it was signed with.
    const got = await verifyToken(SECRET, await signToken(SECRET, base({ t: "c" })));
    expect(got?.t).toBe("c");
  });

  it("carries the rocket spec in `m` for rocket-fit tokens unchanged", async () => {
    const spec = JSON.stringify({ d: 54, c: "K" });
    const got = await verifyToken(SECRET, await signToken(SECRET, base({ t: "rc", m: spec })));
    expect(got?.m).toBe(spec);
  });

  it("rejects a token signed with a different secret (forgery)", async () => {
    const tok = await signToken(SECRET, base());
    expect(await verifyToken("a-different-secret", tok)).toBeNull();
  });

  it("rejects a tampered payload body", async () => {
    const tok = await signToken(SECRET, base());
    const dot = tok.lastIndexOf(".");
    const forged = flipChar(tok.slice(0, dot)) + tok.slice(dot);
    expect(await verifyToken(SECRET, forged)).toBeNull();
  });

  it("rejects a tampered signature of the right length (real byte compare, not just length)", async () => {
    const tok = await signToken(SECRET, base());
    const dot = tok.lastIndexOf(".");
    const forged = tok.slice(0, dot + 1) + flipChar(tok.slice(dot + 1));
    expect(await verifyToken(SECRET, forged)).toBeNull();
  });

  it("rejects a signature of the wrong length (length-checked compare)", async () => {
    const tok = await signToken(SECRET, base());
    const body = tok.slice(0, tok.lastIndexOf("."));
    expect(await verifyToken(SECRET, `${body}.AAAA`)).toBeNull();
  });

  it.each(["", ".", "abc", "abc.", ".abc", "no-dot-here", "@@@.@@@", "a.b.c"])(
    "returns null (never throws) for malformed token %j",
    async (bad) => {
      await expect(verifyToken(SECRET, bad)).resolves.toBeNull();
    },
  );

  describe("expiry", () => {
    it("accepts an unexpired token and rejects an expired one", async () => {
      vi.setSystemTime(new Date("2026-06-12T00:00:00Z"));
      const now = Math.floor(Date.now() / 1000);
      const future = await signToken(SECRET, base({ t: "c", x: now + 3600 }));
      const past = await signToken(SECRET, base({ t: "c", x: now - 1 }));
      expect(await verifyToken(SECRET, future)).not.toBeNull();
      expect(await verifyToken(SECRET, past)).toBeNull();
    });

    it("treats x:0 as non-expiring (unsubscribe links must never go stale)", async () => {
      vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
      const tok = await signToken(SECRET, base({ t: "u", x: 0 }));
      expect(await verifyToken(SECRET, tok)).not.toBeNull();
    });

    it("rejects a valid token once the clock advances past its expiry", async () => {
      vi.setSystemTime(new Date("2026-06-12T00:00:00Z"));
      const tok = await signToken(SECRET, base({ t: "c", x: Math.floor(Date.now() / 1000) + 60 }));
      expect(await verifyToken(SECRET, tok)).not.toBeNull();
      vi.setSystemTime(new Date(Date.now() + 61_000));
      expect(await verifyToken(SECRET, tok)).toBeNull();
    });
  });

  describe("post-signature payload validation", () => {
    // Even a correctly-HMAC'd token must be rejected if its payload shape is
    // wrong — defence against a future signing bug producing a malformed-but-
    // signed token that downstream code would otherwise trust.
    it("rejects an unknown token type", async () => {
      const tok = await signToken(SECRET, { t: "x", e: "a@b", m: "", x: 0 } as unknown as TokenPayload);
      expect(await verifyToken(SECRET, tok)).toBeNull();
    });

    it("rejects a non-string email", async () => {
      const tok = await signToken(SECRET, { t: "c", e: 1, m: "", x: 0 } as unknown as TokenPayload);
      expect(await verifyToken(SECRET, tok)).toBeNull();
    });

    it("rejects a non-string motor key", async () => {
      const tok = await signToken(SECRET, { t: "c", e: "a@b", m: 5, x: 0 } as unknown as TokenPayload);
      expect(await verifyToken(SECRET, tok)).toBeNull();
    });

    it("rejects a non-number expiry", async () => {
      const tok = await signToken(SECRET, { t: "c", e: "a@b", m: "", x: "soon" } as unknown as TokenPayload);
      expect(await verifyToken(SECRET, tok)).toBeNull();
    });
  });
});
