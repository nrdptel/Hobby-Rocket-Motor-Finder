import { describe, expect, it } from "vitest";

import { packSize, unitPriceCents } from "./pack";

describe("packSize", () => {
  it("reads the real per-vendor pack patterns", () => {
    expect(packSize("https://v/aerotech-d13-white-lightning-rms-18-20-3-pack")).toBe(3);
    expect(packSize("https://v/aerotech-c3-4t-p-rms-rc-reload-kit-12-pack-1849.html")).toBe(12);
    expect(packSize("https://v/e15-pw-3pk")).toBe(3);
    expect(packSize("https://v/e24c-4-enerjet-2-pack")).toBe(2);
    expect(packSize("https://v/d20-4w-q-jet-2-pk-1")).toBe(2);
    // URL-encoded fragment (Performance Hobbies): "#D13-4W 3 Pack"
    expect(packSize("https://v/store.aspx?groupid=72#D13-4W%203%20Pack")).toBe(3);
  });

  it("catches the looser real-world forms too", () => {
    expect(packSize("https://v/store#E20-4W%20%28two%20pack%29")).toBe(2); // "two pack"
    expect(packSize("https://v/store#F24-7W%20%283%20packs%29")).toBe(3); // plural "3 packs"
    expect(packSize("https://v/store#G80%20White%20Reload%20%282%20-%20pack%29")).toBe(2); // "2 - pack"
    expect(packSize("https://v/enerjet-by-aerotech-e24-4c-2-motor-pack-52407")).toBe(2); // "2-motor-pack"
    expect(packSize("https://v/aerotech-three-pack-something")).toBe(3); // "three-pack"
  });

  it("treats singles and explicit 1-packs as 1", () => {
    expect(packSize("https://v/aerotech-h128w-rms-29-180")).toBe(1);
    expect(packSize("https://v/k750st-ps-rms-75-1280-reload-kit-1-pack-11750p")).toBe(1);
    expect(packSize("https://v/store.aspx?groupid=42#D10-5W%20%28single%20pack%29")).toBe(1);
    expect(packSize("")).toBe(1);
  });

  it("doesn't mistake stray numbers in a URL for a pack count", () => {
    // Numbers that aren't followed by pack/pk → not a pack.
    expect(packSize("https://v/aerotech-n4000r-ps-rms-98-20480-reload-kit")).toBe(1);
    // Implausibly large "pack" → not trusted.
    expect(packSize("https://v/weird-99-pack")).toBe(1);
  });

  it("prefers the snapshot-resolved pack_size over the URL", () => {
    // The whole point of the consensus fix: a plain URL with the size only known
    // from cross-vendor inference still sizes correctly.
    expect(packSize({ url: "https://c/aerotech-d24-4t-blue-thunder.html", pack_size: 3 })).toBe(3);
    // pack_size wins even if the URL disagrees.
    expect(packSize({ url: "https://v/x-2-pack", pack_size: 3 })).toBe(3);
    // An explicit single from the backend stays a single.
    expect(packSize({ url: "https://v/x-3-pack", pack_size: 1 })).toBe(1);
  });

  it("falls back to the URL when pack_size is absent (old snapshots)", () => {
    expect(packSize({ url: "https://v/d13-3-pack" })).toBe(3);
    expect(packSize({ url: "https://v/h128w" })).toBe(1);
    expect(packSize({ url: null })).toBe(1);
  });

  it("clamps an out-of-range pack_size to a single", () => {
    expect(packSize({ url: "", pack_size: 99 })).toBe(1);
    expect(packSize({ url: "", pack_size: 0 })).toBe(1);
  });
});

describe("unitPriceCents", () => {
  it("divides the pack price by the pack size", () => {
    expect(unitPriceCents(2100, "https://v/d13-3-pack")).toBe(700); // $21 / 3 = $7
    expect(unitPriceCents(8199, "https://v/c-12-pack.html")).toBe(683); // $81.99 / 12, rounded
  });

  it("leaves a single price unchanged", () => {
    expect(unitPriceCents(1299, "https://v/h128w")).toBe(1299);
  });

  it("divides by the resolved pack_size when the URL doesn't carry it", () => {
    // The D24-4T case: CSRocketry's $27.99 is really a 3-pack ($9.33/motor).
    expect(unitPriceCents(2799, { url: "https://c/aerotech-d24-4t.html", pack_size: 3 })).toBe(933);
    // Moto-Joe's $19.00 3-pack → $6.33/motor.
    expect(unitPriceCents(1900, { url: "https://m/index.php?product_id=166", pack_size: 3 })).toBe(633);
  });

  it("passes null through", () => {
    expect(unitPriceCents(null, "https://v/d13-3-pack")).toBeNull();
  });
});
