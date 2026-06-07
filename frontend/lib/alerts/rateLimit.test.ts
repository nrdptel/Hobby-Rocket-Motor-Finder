import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Upstash transport so we test the rate-limit/cooldown LOGIC (boolean
// polarity, fail-closed propagation) without a live store. This is the guard the
// re-evaluation asked for: a future refactor that flips setNxEx's return contract
// would otherwise silently invert the anti-inbox-bomb cooldown into an enabler.
const setNxEx = vi.fn();
const incrWithTtl = vi.fn();
const del = vi.fn();

vi.mock("./upstash", () => ({
  setNxEx: (...a: unknown[]) => setNxEx(...a),
  incrWithTtl: (...a: unknown[]) => incrWithTtl(...a),
  del: (...a: unknown[]) => del(...a),
}));

import type { AlertConfig } from "./config";
import {
  confirmRecentlySent,
  overGlobalConfirmCap,
  overIpLimit,
  releaseConfirmCooldown,
  utcHour,
} from "./rateLimit";

const cfg = {} as AlertConfig;

beforeEach(() => {
  setNxEx.mockReset();
  incrWithTtl.mockReset();
  del.mockReset();
});

describe("confirmRecentlySent (per-recipient cooldown)", () => {
  it("returns false on first send (claim succeeds), true on a recent repeat", async () => {
    setNxEx.mockResolvedValueOnce(true); // NX claim succeeded → first send
    expect(await confirmRecentlySent(cfg, "a@b.com")).toBe(false); // proceed to send
    expect(setNxEx).toHaveBeenCalledWith(cfg, "csent:a@b.com", 600);
    setNxEx.mockResolvedValueOnce(false); // key already exists → recently sent
    expect(await confirmRecentlySent(cfg, "a@b.com")).toBe(true); // suppress
  });

  it("propagates a store error so the caller can fail CLOSED", async () => {
    setNxEx.mockRejectedValueOnce(new Error("upstash down"));
    await expect(confirmRecentlySent(cfg, "a@b.com")).rejects.toThrow();
  });
});

describe("overGlobalConfirmCap (hourly cap = 300)", () => {
  it("is false at the cap and true past it", async () => {
    incrWithTtl.mockResolvedValueOnce(300);
    expect(await overGlobalConfirmCap(cfg, "2026-06-06T18")).toBe(false);
    incrWithTtl.mockResolvedValueOnce(301);
    expect(await overGlobalConfirmCap(cfg, "2026-06-06T18")).toBe(true);
  });

  it("propagates a store error (fail closed)", async () => {
    incrWithTtl.mockRejectedValueOnce(new Error("down"));
    await expect(overGlobalConfirmCap(cfg, "2026-06-06T18")).rejects.toThrow();
  });
});

describe("overIpLimit", () => {
  it("is false at the max and true past it", async () => {
    incrWithTtl.mockResolvedValueOnce(12);
    expect(await overIpLimit(cfg, "rl:sub", "1.2.3.4", 12)).toBe(false);
    incrWithTtl.mockResolvedValueOnce(13);
    expect(await overIpLimit(cfg, "rl:sub", "1.2.3.4", 12)).toBe(true);
  });
});

describe("releaseConfirmCooldown", () => {
  it("deletes the cooldown key and swallows a store error", async () => {
    del.mockResolvedValueOnce(undefined);
    await expect(releaseConfirmCooldown(cfg, "a@b.com")).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith(cfg, "csent:a@b.com");
    del.mockRejectedValueOnce(new Error("down"));
    await expect(releaseConfirmCooldown(cfg, "a@b.com")).resolves.toBeUndefined(); // no throw
  });
});

describe("utcHour", () => {
  it("is YYYY-MM-DDTHH", () => {
    expect(utcHour()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
  });
});
