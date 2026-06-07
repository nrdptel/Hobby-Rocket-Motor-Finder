import { describe, expect, it } from "vitest";

import { buildCatalogView, filterCatalog, parseCatalogParams, type CatalogParams } from "./catalog";
import type { Listing, Motor } from "./snapshot";

function listing(over: Partial<Listing> = {}): Listing {
  return {
    vendor_slug: "csrocketry",
    vendor_name: "Chris' Rocket Supplies",
    url: "https://x/p",
    sku: null,
    raw_designation: "X",
    price_cents: 5000,
    currency: "USD",
    status: "in_stock",
    stock_count: null,
    seen_at: "2026-06-06T12:00:00+00:00",
    ...over,
  };
}

function motor(over: Partial<Motor> = {}): Motor {
  return {
    id: 1,
    manufacturer: "AeroTech",
    designation: "J90W",
    common_name: "J90",
    diameter_mm: 54,
    impulse_class: "J",
    total_impulse_ns: 2000,
    avg_thrust_n: 90,
    burn_time_s: 5,
    propellant: "White Lightning",
    delays: "6,10,14",
    delay_adjustable: true,
    motor_type: "reload",
    case_info: "RMS-54/852",
    listings: [listing()],
    ...over,
  };
}

// A small, varied catalog touching every filter dimension.
const CATALOG: Motor[] = [
  motor({ id: 1, manufacturer: "AeroTech", designation: "J90W", diameter_mm: 54, impulse_class: "J",
    total_impulse_ns: 2000, propellant: "White Lightning", case_info: "RMS-54/852",
    listings: [listing({ vendor_slug: "wildman", status: "in_stock", price_cents: 7000 })] }),
  motor({ id: 2, manufacturer: "Cesaroni Technology", designation: "K530", diameter_mm: 54, impulse_class: "K",
    total_impulse_ns: 2500, propellant: "Blue Streak", case_info: "Pro54-5G",
    listings: [listing({ vendor_slug: "sirius", status: "out_of_stock", price_cents: 8000 })] }),
  motor({ id: 3, manufacturer: "AeroTech", designation: "H128W", diameter_mm: 29, impulse_class: "H",
    total_impulse_ns: 200, propellant: "White Lightning", case_info: "RMS-29/40",
    listings: [listing({ vendor_slug: "csrocketry", status: "in_stock", price_cents: 3000 })] }),
];

const EMPTY = parseCatalogParams(() => undefined);

describe("parseCatalogParams", () => {
  it("parses every filter dimension from a getter", () => {
    const q: Record<string, string> = {
      mfr: "AeroTech,Cesaroni",
      class: "J,K",
      dia: "54",
      cert: "l2",
      case: "RMS-54/852",
      prop: "White Lightning",
      vendor: "wildman",
      in_stock: "1",
      sort: "price",
      order: "impulse",
      dir: "desc",
      starred: "1",
      q: "  J90  ",
      imin: "1000",
      imax: "5000",
    };
    const p = parseCatalogParams((k) => q[k]);
    expect(p.mfr).toEqual(new Set(["AeroTech", "Cesaroni"]));
    expect(p.cls).toEqual(new Set(["J", "K"]));
    expect(p.dia).toEqual(new Set(["54"]));
    expect(p.cert).toEqual(new Set(["l2"]));
    expect(p.cases).toEqual(new Set(["RMS-54/852"]));
    expect(p.props).toEqual(new Set(["White Lightning"]));
    expect(p.vendors).toEqual(new Set(["wildman"]));
    expect(p.inStock).toBe(true);
    expect(p.listingSort).toBe("price");
    expect(p.order).toBe("impulse");
    expect(p.dir).toBe("desc");
    expect(p.starredOnly).toBe(true);
    expect(p.query).toBe("j90"); // trimmed + lowercased
    expect(p.minImpulse).toBe(1000);
    expect(p.maxImpulse).toBe(5000);
  });

  it("defaults everything for an empty getter", () => {
    expect(EMPTY.mfr.size).toBe(0);
    expect(EMPTY.inStock).toBe(false);
    expect(EMPTY.listingSort).toBe("stock");
    expect(EMPTY.order).toBe("class");
    expect(EMPTY.dir).toBe("asc");
    expect(EMPTY.query).toBe("");
    expect(EMPTY.minImpulse).toBeNull();
  });
});

const ids = (p: CatalogParams) => filterCatalog(CATALOG, p).map((m) => m.id);

describe("filterCatalog — each dimension narrows like the original page", () => {
  it("no filter → all motors", () => expect(ids(EMPTY).sort()).toEqual([1, 2, 3]));
  it("manufacturer", () =>
    expect(ids({ ...EMPTY, mfr: new Set(["Cesaroni"]) })).toEqual([2]));
  it("class", () => expect(ids({ ...EMPTY, cls: new Set(["H"]) })).toEqual([3]));
  it("cert expands to classes (L2 = J/K, not H)", () =>
    expect(ids({ ...EMPTY, cert: new Set(["l2"]) }).sort()).toEqual([1, 2]));
  it("diameter", () => expect(ids({ ...EMPTY, dia: new Set(["29"]) })).toEqual([3]));
  it("case", () =>
    expect(ids({ ...EMPTY, cases: new Set(["Pro54-5G"]) })).toEqual([2]));
  it("propellant", () =>
    expect(ids({ ...EMPTY, props: new Set(["Blue Streak"]) })).toEqual([2]));
  it("vendor", () =>
    expect(ids({ ...EMPTY, vendors: new Set(["csrocketry"]) })).toEqual([3]));
  it("in-stock only", () => expect(ids({ ...EMPTY, inStock: true }).sort()).toEqual([1, 3]));
  it("impulse band", () =>
    expect(ids({ ...EMPTY, minImpulse: 1000, maxImpulse: 2200 })).toEqual([1]));
  it("query matches designation/common/variety", () =>
    expect(ids({ ...EMPTY, query: "k530" })).toEqual([2]));
});

describe("buildCatalogView", () => {
  it("groups by delay and trims to in-stock listings when in_stock is on", () => {
    const view = buildCatalogView(CATALOG, { ...EMPTY, inStock: true });
    expect(view.motors.map((m) => m.id).sort()).toEqual([1, 3]);
    // every grouped listing is in stock
    for (const m of view.motors)
      for (const g of m.delayGroups)
        for (const l of g.listings) expect(l.status).toMatch(/in_stock/);
    expect(view.motors[0].delayGroups.length).toBeGreaterThan(0);
  });

  it("offers substitutes for a sold-out motor (same diameter+class, in stock)", () => {
    // A sold-out 54mm K next to an in-stock 54mm K of close impulse.
    const soldOut = motor({ id: 10, impulse_class: "K", diameter_mm: 54, total_impulse_ns: 2500,
      listings: [listing({ status: "out_of_stock" })] });
    const swap = motor({ id: 11, designation: "K540", impulse_class: "K", diameter_mm: 54,
      total_impulse_ns: 2550, listings: [listing({ status: "in_stock", price_cents: 6000 })] });
    const view = buildCatalogView([soldOut, swap], EMPTY);
    expect(view.substitutes[10]?.[0]?.designation).toBe("K540");
    expect(view.substitutes[11]).toBeUndefined(); // in-stock motor gets none
  });
});
