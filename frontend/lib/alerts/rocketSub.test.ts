import { describe, expect, it } from "vitest";

import { motorFitsRocket } from "../rocketFit";
import {
  describeRocketFields,
  fieldsToSpec,
  normalizeRocketFields,
  parseRocketMember,
  parseRocketSpecField,
  rocketDisplayName,
  rocketMember,
  rocketSpecField,
  shortHash,
  type RocketFields,
} from "./rocketSub";

const FIELDS: RocketFields = { d: 54, c: "l2", mn: 1000, mx: 5120, l: "Punisher" };

describe("normalizeRocketFields", () => {
  it("accepts a valid rocket + clamps a long label", () => {
    const f = normalizeRocketFields({
      diameterMm: 54,
      cert: "l2",
      minImpulseNs: 1000,
      maxImpulseNs: 5120,
      label: "Punisher",
    });
    expect(f).toEqual(FIELDS);
  });
  it("rejects bad diameter / cert", () => {
    expect(normalizeRocketFields({ diameterMm: 0, cert: "l2" })).toBeNull();
    expect(normalizeRocketFields({ diameterMm: 54, cert: "nope" })).toBeNull();
    expect(normalizeRocketFields({ diameterMm: "54", cert: "l2" })).toBeNull();
  });
  it("rejects an inverted impulse band", () => {
    expect(normalizeRocketFields({ diameterMm: 54, cert: "l2", minImpulseNs: 5000, maxImpulseNs: 1000 })).toBeNull();
  });
  it("treats negative/blank bounds as open", () => {
    const f = normalizeRocketFields({ diameterMm: 38, cert: "l1", minImpulseNs: -5, maxImpulseNs: null });
    expect(f).toEqual({ d: 38, c: "l1", mn: null, mx: null, l: "" });
  });
});

describe("spec field round-trip (token payload)", () => {
  it("serializes + parses without the email", () => {
    const s = rocketSpecField(FIELDS);
    expect(s).not.toContain("@");
    expect(parseRocketSpecField(s)).toEqual(FIELDS);
  });
  it("is deterministic (stable key order)", () => {
    expect(rocketSpecField(FIELDS)).toBe(rocketSpecField({ ...FIELDS }));
  });
  it("rejects garbage", () => {
    expect(parseRocketSpecField("not json")).toBeNull();
    expect(parseRocketSpecField('{"d":"x"}')).toBeNull();
  });
});

describe("member round-trip (Upstash set member)", () => {
  it("carries the email and is stable for SREM", () => {
    const m1 = rocketMember("a@b.com", FIELDS);
    const m2 = rocketMember("a@b.com", FIELDS);
    expect(m1).toBe(m2); // identical → SREM works across both sets
    expect(parseRocketMember(m1)).toEqual({ email: "a@b.com", fields: FIELDS });
  });
  it("rejects a member without an email", () => {
    expect(parseRocketMember(rocketSpecField(FIELDS))).toBeNull();
  });
});

describe("describeRocketFields / rocketDisplayName", () => {
  it("describes diameter, cert and band", () => {
    expect(describeRocketFields(FIELDS)).toBe("54mm · L2 · 1000–5120 N·s");
    expect(describeRocketFields({ d: 38, c: "l1", mn: 200, mx: null, l: "" })).toBe("38mm · L1 · ≥200 N·s");
    expect(describeRocketFields({ d: 75, c: "l3", mn: null, mx: 9000, l: "" })).toBe("75mm · L3 · ≤9000 N·s");
  });
  it("prefers the label, falls back to the spec", () => {
    expect(rocketDisplayName(FIELDS)).toBe("Punisher");
    expect(rocketDisplayName({ ...FIELDS, l: "" })).toBe("54mm · L2 · 1000–5120 N·s");
  });
});

describe("fieldsToSpec drives the fit function", () => {
  it("a fitting motor matches; a wrong-diameter one doesn't", () => {
    const spec = fieldsToSpec(FIELDS);
    expect(motorFitsRocket(spec, { diameter_mm: 54, impulse_class: "K", total_impulse_ns: 2000 })).toBe(true);
    expect(motorFitsRocket(spec, { diameter_mm: 38, impulse_class: "K", total_impulse_ns: 2000 })).toBe(false);
    // outside the band
    expect(motorFitsRocket(spec, { diameter_mm: 54, impulse_class: "J", total_impulse_ns: 800 })).toBe(false);
  });
});

describe("shortHash", () => {
  it("is stable and hex", () => {
    expect(shortHash("abc")).toBe(shortHash("abc"));
    expect(shortHash("abc")).toMatch(/^[0-9a-f]+$/);
    expect(shortHash("abc")).not.toBe(shortHash("abd"));
  });
});
