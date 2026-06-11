import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Upstash transport so we test the rate-limit/cooldown LOGIC (boolean
// polarity, fail-closed propagation) without a live store. This is the guard the
// re-evaluation asked for: a future refactor that flips setNxEx's return contract
// would otherwise silently invert the anti-inbox-bomb cooldown into an enabler.
const setNxEx = vi.fn();
const incrWithTtl = vi.fn();
const del = vi.fn();
const ttl = vi.fn();

vi.mock("./upstash", () => ({
  setNxEx: (...a: unknown[]) => setNxEx(...a),
  incrWithTtl: (...a: unknown[]) => incrWithTtl(...a),
  del: (...a: unknown[]) => del(...a),
  ttl: (...a: unknown[]) => ttl(...a),
}));

import type { AlertConfig } from "./config";
import {
  confirmRecentlySent,
  formatRetry,
  overGlobalConfirmCap,
  overIpLimit,
  rateLimitedResponse,
  releaseConfirmCooldown,
  utcHour,
} from "./rateLimit";

const cfg = {} as AlertConfig;

beforeEach(() => {
  setNxEx.mockReset();
  incrWithTtl.mockReset();
  del.mockReset();
  ttl.mockReset();
});

describe("confirmRecentlySent (per-recipient cooldown)", () => {
  it("returns false on first send (claim succeeds), true on a recent repeat", async () => {
    setNxEx.mockResolvedValueOnce(true); // NX claim succeeded → first send
    expect(await confirmRecentlySent(cfg, "a@b.com", "AeroTech::J350W")).toBe(false); // proceed
    expect(setNxEx).toHaveBeenCalledWith(cfg, "csent:a@b.com:AeroTech::J350W", 600);
    setNxEx.mockResolvedValueOnce(false); // key already exists → recently sent
    expect(await confirmRecentlySent(cfg, "a@b.com", "AeroTech::J350W")).toBe(true); // suppress
  });

  it("keys on (email, target) so a different motor isn't blocked", async () => {
    // Same address, two different motors → two distinct keys, both claimable.
    setNxEx.mockResolvedValue(true);
    expect(await confirmRecentlySent(cfg, "a@b.com", "AeroTech::J350W")).toBe(false);
    expect(await confirmRecentlySent(cfg, "a@b.com", "Cesaroni::K400")).toBe(false);
    expect(setNxEx).toHaveBeenCalledWith(cfg, "csent:a@b.com:AeroTech::J350W", 600);
    expect(setNxEx).toHaveBeenCalledWith(cfg, "csent:a@b.com:Cesaroni::K400", 600);
  });

  it("propagates a store error so the caller can fail CLOSED", async () => {
    setNxEx.mockRejectedValueOnce(new Error("upstash down"));
    await expect(confirmRecentlySent(cfg, "a@b.com", "AeroTech::J350W")).rejects.toThrow();
  });
});

describe("overGlobalConfirmCap (hourly cap = 300)", () => {
  it("is not limited at the cap, limited past it (with a retry-after)", async () => {
    incrWithTtl.mockResolvedValueOnce(300);
    expect(await overGlobalConfirmCap(cfg, "2026-06-06T18")).toEqual({ limited: false, retryAfterS: 0 });
    incrWithTtl.mockResolvedValueOnce(301);
    ttl.mockResolvedValueOnce(1800);
    expect(await overGlobalConfirmCap(cfg, "2026-06-06T18")).toEqual({ limited: true, retryAfterS: 1800 });
  });

  it("propagates a store error (fail closed)", async () => {
    incrWithTtl.mockRejectedValueOnce(new Error("down"));
    await expect(overGlobalConfirmCap(cfg, "2026-06-06T18")).rejects.toThrow();
  });
});

describe("overIpLimit", () => {
  it("is not limited at the max, limited past it (retry-after = key TTL)", async () => {
    incrWithTtl.mockResolvedValueOnce(12);
    expect(await overIpLimit(cfg, "rl:sub", "1.2.3.4", 12)).toEqual({ limited: false, retryAfterS: 0 });
    incrWithTtl.mockResolvedValueOnce(13);
    ttl.mockResolvedValueOnce(2400);
    expect(await overIpLimit(cfg, "rl:sub", "1.2.3.4", 12)).toEqual({ limited: true, retryAfterS: 2400 });
  });

  it("falls back to the full window when the key has no TTL (-1/-2)", async () => {
    incrWithTtl.mockResolvedValueOnce(13);
    ttl.mockResolvedValueOnce(-2); // key gone between INCR and TTL
    expect(await overIpLimit(cfg, "rl:sub", "1.2.3.4", 12, 3600)).toEqual({
      limited: true,
      retryAfterS: 3600,
    });
  });
});

describe("formatRetry", () => {
  it("renders a human phrase", () => {
    expect(formatRetry(30)).toBe("less than a minute");
    expect(formatRetry(60)).toBe("less than a minute");
    expect(formatRetry(61)).toBe("about 2 minutes");
    expect(formatRetry(120)).toBe("about 2 minutes");
    expect(formatRetry(90)).toBe("about 2 minutes");
    expect(formatRetry(3300)).toBe("about an hour");
  });
});

describe("rateLimitedResponse", () => {
  it("returns 429 with a time-aware message, Retry-After header, and retryAfterS", async () => {
    const res = rateLimitedResponse(1800, "Any confirmations already sent are in your inbox.");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1800");
    const body = await res.json();
    expect(body.retryAfterS).toBe(1800);
    expect(body.error).toContain("about 30 minutes");
    expect(body.error).toContain("already sent are in your inbox");
  });
});

describe("releaseConfirmCooldown", () => {
  it("deletes the cooldown key and swallows a store error", async () => {
    del.mockResolvedValueOnce(undefined);
    await expect(releaseConfirmCooldown(cfg, "a@b.com", "AeroTech::J350W")).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith(cfg, "csent:a@b.com:AeroTech::J350W");
    del.mockRejectedValueOnce(new Error("down"));
    await expect(releaseConfirmCooldown(cfg, "a@b.com", "AeroTech::J350W")).resolves.toBeUndefined(); // no throw
  });
});

describe("utcHour", () => {
  it("is YYYY-MM-DDTHH", () => {
    expect(utcHour()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
  });
});
