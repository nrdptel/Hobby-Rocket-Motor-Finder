import { describe, expect, it } from "vitest";

import { clientIp, motorKey, normalizeEmail, subKey, userMotorsKey } from "./config";

const req = (h: Record<string, string>) => new Request("https://example.test", { headers: h });

describe("normalizeEmail", () => {
  it("lowercases so case variants resolve to one subscriber / rate-limit key", () => {
    // If "Alice@x.com" and "alice@x.com" keyed differently, the per-recipient
    // cooldown and subscriber-set dedupe could be bypassed.
    expect(normalizeEmail("Alice@Example.COM")).toBe("alice@example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  bob@x.io  ")).toBe("bob@x.io");
  });

  it("accepts plus-tagged and subdomained addresses", () => {
    expect(normalizeEmail("user+tag@mail.example.co.uk")).toBe("user+tag@mail.example.co.uk");
  });

  it.each([null, undefined, 123, {}, []])("rejects non-string %j", (v) => {
    expect(normalizeEmail(v as unknown)).toBeNull();
  });

  it.each([
    "",
    "ab", // shorter than 3
    "a@",
    "@b.com",
    "no-at-sign",
    "a@b", // no dot in domain
    "a b@x.com", // space in local part
    "a@x .com", // space in domain
    "a@@b.com",
    "a@b.com\nx@y.com", // embedded newline (header-injection shaped)
  ])("rejects invalid address %j", (v) => {
    expect(normalizeEmail(v)).toBeNull();
  });

  it("rejects an over-long address (>254 chars)", () => {
    expect(normalizeEmail(`${"a".repeat(250)}@x.com`)).toBeNull();
  });
});

describe("clientIp anti-spoof precedence", () => {
  it("prefers the platform-set x-vercel-forwarded-for over the spoofable x-forwarded-for", () => {
    // x-forwarded-for is client-supplied on Vercel; trusting it would let an
    // attacker rotate the rate-limit key per request and email-bomb.
    const ip = clientIp(
      req({
        "x-forwarded-for": "1.1.1.1", // attacker-controlled
        "x-vercel-forwarded-for": "9.9.9.9", // platform-set, trusted
        "x-real-ip": "8.8.8.8",
      }),
    );
    expect(ip).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip when no vercel header is present", () => {
    expect(clientIp(req({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1" }))).toBe("8.8.8.8");
  });

  it("uses x-forwarded-for only off-platform (no trusted headers)", () => {
    expect(clientIp(req({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" }))).toBe("2.2.2.2");
  });

  it("returns 'unknown' when no IP headers are present", () => {
    expect(clientIp(req({}))).toBe("unknown");
  });

  it("takes the leftmost entry and trims surrounding spaces", () => {
    expect(clientIp(req({ "x-vercel-forwarded-for": " 9.9.9.9 , 7.7.7.7 " }))).toBe("9.9.9.9");
  });
});

describe("motorKey", () => {
  it("joins manufacturer + designation with '::' and trims each side", () => {
    expect(motorKey(" AeroTech ", " H128W ")).toBe("AeroTech::H128W");
  });

  it("collides for trimmed vs untrimmed input (no duplicate subscriber sets)", () => {
    expect(motorKey(" AeroTech ", "H128W ")).toBe(motorKey("AeroTech", "H128W"));
  });
});

describe("redis key namespaces", () => {
  it("prefix the motor / email keys", () => {
    expect(subKey("AeroTech::H128W")).toBe("sub:AeroTech::H128W");
    expect(userMotorsKey("a@b.com")).toBe("umotors:a@b.com");
  });
});
