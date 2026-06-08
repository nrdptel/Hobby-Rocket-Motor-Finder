import { describe, expect, it } from "vitest";

import { isPhantom, mergedCatalog, motorKey, phantomMotors, type CatalogRecord } from "./catalogMotors";
import { sortedMotors } from "./derive";
import type { Listing, Motor } from "./snapshot";

const rec = (over: Partial<CatalogRecord>): CatalogRecord => ({
  manufacturer: "AeroTech",
  designation: "H100W",
  diameter: 29,
  impulseClass: "H",
  totImpulseNs: 200,
  avgThrustN: 100,
  burnTimeS: 2,
  propInfo: "White Lightning",
  type: "reload",
  caseInfo: "RMS-29/180",
  availability: "regular",
  ...over,
});

const stockedMotor = (over: Partial<Motor>): Motor => ({
  id: 1,
  manufacturer: "AeroTech",
  designation: "H100W",
  diameter_mm: 29,
  impulse_class: "H",
  total_impulse_ns: 200,
  avg_thrust_n: 100,
  burn_time_s: 2,
  propellant: "White Lightning",
  delays: null,
  delay_adjustable: false,
  listings: [{ status: "in_stock" } as Listing],
  ...over,
});

describe("phantomMotors", () => {
  it("includes catalog motors that aren't stocked, with empty listings", () => {
    const records = [rec({ designation: "H100W" }), rec({ designation: "I285R", impulseClass: "I" })];
    const stocked = new Set([motorKey("AeroTech", "H100W")]);
    const phantoms = phantomMotors(records, stocked, "D");
    expect(phantoms.map((m) => m.designation)).toEqual(["I285R"]); // H100W is stocked
    expect(phantoms[0].listings).toEqual([]);
    expect(isPhantom(phantoms[0])).toBe(true);
  });

  it("maps catalog fields onto the Motor shape and flags OOP as discontinued", () => {
    const [m] = phantomMotors([rec({ designation: "G80", impulseClass: "G", availability: "OOP", type: "SU", caseInfo: null, propInfo: null })], new Set(), "D");
    expect(m).toMatchObject({
      designation: "G80",
      diameter_mm: 29,
      impulse_class: "G",
      total_impulse_ns: 200,
      motor_type: "SU",
      case_info: null,
      propellant: null,
      discontinued: true,
    });
  });

  it("excludes classes below minClass", () => {
    const records = [rec({ designation: "C3", impulseClass: "C" }), rec({ designation: "D10", impulseClass: "D" })];
    expect(phantomMotors(records, new Set(), "D").map((m) => m.designation)).toEqual(["D10"]);
  });

  it("gives phantoms stable, negative, collision-free ids", () => {
    const [a] = phantomMotors([rec({ designation: "X1" })], new Set(), "D");
    const [b] = phantomMotors([rec({ designation: "X1" })], new Set(), "D");
    const [c] = phantomMotors([rec({ designation: "X2" })], new Set(), "D");
    expect(a.id).toBe(b.id); // deterministic
    expect(a.id).toBeLessThan(0); // never collides with positive DB ids
    expect(a.id).not.toBe(c.id);
  });
});

describe("mergedCatalog", () => {
  it("merges stocked motors (D+) with phantoms and dedups by designation", () => {
    const snapshot = [stockedMotor({ designation: "H100W" })];
    const records = [rec({ designation: "H100W" }), rec({ designation: "J350W", impulseClass: "J" })];
    const all = mergedCatalog(snapshot, records, "D");
    expect(all.map((m) => m.designation).sort()).toEqual(["H100W", "J350W"]);
    expect(all.find((m) => m.designation === "H100W")!.listings.length).toBe(1); // the stocked one wins
    expect(isPhantom(all.find((m) => m.designation === "J350W")!)).toBe(true);
  });

  it("drops a sub-D stocked motor from the universe", () => {
    const snapshot = [stockedMotor({ designation: "C3", impulse_class: "C" })];
    expect(mergedCatalog(snapshot, [], "D")).toEqual([]);
  });
});

describe("sortedMotors sinks phantoms below real motors", () => {
  it("keeps stocked motors first regardless of order", () => {
    const stocked = stockedMotor({ id: 1, designation: "H100W", impulse_class: "H" });
    const phantom = { ...stockedMotor({ id: -2, designation: "K100", impulse_class: "K" }), listings: [] };
    // K > H, so by class-desc the phantom would lead — but phantoms always sink.
    const sorted = sortedMotors([phantom, stocked], "class", "desc");
    expect(sorted.map((m) => m.designation)).toEqual(["H100W", "K100"]);
  });
});
