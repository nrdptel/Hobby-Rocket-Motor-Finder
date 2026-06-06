import { describe, expect, it } from "vitest";

import { motorKey, normalizeEmail, subKey, userMotorsKey } from "./config";
import { designationFromKey, managePage, splitKey } from "./resultPage";
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

describe("redis key helpers", () => {
  it("derive stable, distinct keys", () => {
    expect(subKey("AeroTech::J500G")).toBe("sub:AeroTech::J500G");
    expect(userMotorsKey("flyer@example.com")).toBe("umotors:flyer@example.com");
  });
});

describe("splitKey", () => {
  it("recovers both halves of a motorKey", () => {
    expect(splitKey("AeroTech::J500G-14A")).toEqual({
      manufacturer: "AeroTech",
      designation: "J500G-14A",
    });
  });
  it("treats a key without :: as a bare designation", () => {
    expect(splitKey("J500G")).toEqual({ manufacturer: "", designation: "J500G" });
  });
});

describe("managePage", () => {
  it("lists subscriptions with per-motor + unsubscribe-all links", async () => {
    const tok = "tok123";
    const res = managePage(
      "flyer@example.com",
      ["AeroTech::J500G", "Cesaroni Technology::I445"],
      tok,
      "https://x.test",
    );
    const html = await res.text();
    expect(html).toContain("flyer@example.com");
    expect(html).toContain("J500G");
    expect(html).toContain("I445");
    expect(html).toContain("Cesaroni Technology");
    // unsub link is token-scoped + motorKey-encoded
    expect(html).toContain(`unsub=${encodeURIComponent("AeroTech::J500G")}`);
    expect(html).toContain("unsuball=1");
  });

  it("shows an empty state with no unsubscribe-all link", async () => {
    const res = managePage("flyer@example.com", [], "t", "https://x.test");
    const html = await res.text();
    expect(html).toContain("no active restock alerts");
    expect(html).not.toContain("unsuball=1");
  });

  it("escapes the email to avoid HTML injection", async () => {
    const res = managePage("a<b>@x.com", [], "t", "https://x.test");
    const html = await res.text();
    expect(html).not.toContain("<b>");
    expect(html).toContain("a&lt;b&gt;");
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

  it("round-trips a manage token (whole-email, no motor)", async () => {
    const tok = await signToken(SECRET, { t: "m", e: "a@b.com", m: "", x: now() + 3600 });
    const payload = await verifyToken(SECRET, tok);
    expect(payload?.t).toBe("m");
    expect(payload?.e).toBe("a@b.com");
  });

  it("rejects an expired manage token", async () => {
    const tok = await signToken(SECRET, { t: "m", e: "a@b.com", m: "", x: now() - 10 });
    expect(await verifyToken(SECRET, tok)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifyToken(SECRET, "garbage")).toBeNull();
    expect(await verifyToken(SECRET, "")).toBeNull();
    expect(await verifyToken(SECRET, "a.b.c")).toBeNull();
  });
});
