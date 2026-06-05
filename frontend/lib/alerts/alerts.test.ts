import { describe, expect, it } from "vitest";

import { motorKey, normalizeEmail } from "./config";
import { designationFromKey } from "./resultPage";
import { signToken, verifyToken, type TokenPayload } from "./tokens";

const SECRET = "test-secret-key";
const now = () => Math.floor(Date.now() / 1000);

describe("motorKey", () => {
  it("joins manufacturer + designation stably and trims", () => {
    expect(motorKey("AeroTech", "J500G-14A")).toBe("AeroTech::J500G-14A");
    expect(motorKey("  Cesaroni Technology ", " I445 ")).toBe("Cesaroni Technology::I445");
  });
});

describe("designationFromKey", () => {
  it("recovers the designation half of a motorKey", () => {
    expect(designationFromKey("AeroTech::J500G-14A")).toBe("J500G-14A");
    // CTI designations never contain '::', so the first split is correct.
    expect(designationFromKey("Cesaroni Technology::I445")).toBe("I445");
  });
});

describe("normalizeEmail", () => {
  it("lowercases + trims valid addresses", () => {
    expect(normalizeEmail("  Flyer@Example.COM ")).toBe("flyer@example.com");
  });
  it("rejects invalid / non-string / oversized input", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail("x".repeat(250) + "@e.com")).toBeNull();
  });
});

describe("tokens", () => {
  const base: TokenPayload = { t: "c", e: "flyer@example.com", m: "AeroTech::J500G", x: 0 };

  it("round-trips a valid token", async () => {
    const tok = await signToken(SECRET, { ...base, x: now() + 3600 });
    const payload = await verifyToken(SECRET, tok);
    expect(payload).not.toBeNull();
    expect(payload?.e).toBe("flyer@example.com");
    expect(payload?.m).toBe("AeroTech::J500G");
    expect(payload?.t).toBe("c");
  });

  it("rejects a token signed with a different secret", async () => {
    const tok = await signToken(SECRET, { ...base, x: now() + 3600 });
    expect(await verifyToken("other-secret", tok)).toBeNull();
  });

  it("rejects a tampered body", async () => {
    const tok = await signToken(SECRET, { ...base, x: now() + 3600 });
    const [body, sig] = tok.split(".");
    const tampered = `${body}x.${sig}`;
    expect(await verifyToken(SECRET, tampered)).toBeNull();
  });

  it("rejects an expired confirm token", async () => {
    const tok = await signToken(SECRET, { ...base, x: now() - 10 });
    expect(await verifyToken(SECRET, tok)).toBeNull();
  });

  it("treats x=0 as no expiry (unsubscribe tokens never expire)", async () => {
    const tok = await signToken(SECRET, { t: "u", e: "a@b.com", m: "X::Y", x: 0 });
    const payload = await verifyToken(SECRET, tok);
    expect(payload?.t).toBe("u");
  });

  it("rejects garbage", async () => {
    expect(await verifyToken(SECRET, "garbage")).toBeNull();
    expect(await verifyToken(SECRET, "")).toBeNull();
    expect(await verifyToken(SECRET, "a.b.c")).toBeNull();
  });
});
