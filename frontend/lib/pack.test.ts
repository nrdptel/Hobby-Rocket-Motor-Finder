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
});

describe("unitPriceCents", () => {
  it("divides the pack price by the pack size", () => {
    expect(unitPriceCents(2100, "https://v/d13-3-pack")).toBe(700); // $21 / 3 = $7
    expect(unitPriceCents(8199, "https://v/c-12-pack.html")).toBe(683); // $81.99 / 12, rounded
  });

  it("leaves a single price unchanged", () => {
    expect(unitPriceCents(1299, "https://v/h128w")).toBe(1299);
  });

  it("passes null through", () => {
    expect(unitPriceCents(null, "https://v/d13-3-pack")).toBeNull();
  });
});
