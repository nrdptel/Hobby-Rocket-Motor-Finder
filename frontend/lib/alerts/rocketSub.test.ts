import { describe, expect, it } from "vitest";

import { SINGLE_USE_CASE } from "../derive";
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

const FIELDS: RocketFields = {
  d: 54,
  c: "l2",
  k: null,
  cs: null,
  mn: 1000,
  mx: 5120,
  l: "Punisher",
};

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
  it("requires only the diameter; cert/class/case are optional", () => {
    // Just a diameter is a valid sub now.
    expect(normalizeRocketFields({ diameterMm: 54 })).toEqual({
      d: 54,
      c: null,
      k: null,
      cs: null,
      mn: null,
      mx: null,
      l: "",
    });
    // An unknown cert is dropped (not rejected).
    expect(normalizeRocketFields({ diameterMm: 54, cert: "nope" })?.c).toBeNull();
  });
  it("normalizes a class letter and a reload case", () => {
    const f = normalizeRocketFields({
      diameterMm: 54,
      impulseClass: "j",
      caseInfo: "  RMS-54/1706  ",
    });
    expect(f).toMatchObject({ d: 54, k: "J", cs: "RMS-54/1706" });
    // A non-letter class is dropped.
    expect(normalizeRocketFields({ diameterMm: 54, impulseClass: "JJ" })?.k).toBeNull();
    expect(normalizeRocketFields({ diameterMm: 54, impulseClass: "7" })?.k).toBeNull();
  });
  it("rejects a bad diameter", () => {
    expect(normalizeRocketFields({ diameterMm: 0, cert: "l2" })).toBeNull();
    expect(normalizeRocketFields({ diameterMm: "54", cert: "l2" })).toBeNull();
  });
  it("rejects an inverted impulse band", () => {
    expect(
      normalizeRocketFields({ diameterMm: 54, cert: "l2", minImpulseNs: 5000, maxImpulseNs: 1000 }),
    ).toBeNull();
  });
  it("treats negative/blank bounds as open", () => {
    const f = normalizeRocketFields({ diameterMm: 38, cert: "l1", minImpulseNs: -5, maxImpulseNs: null });
    expect(f).toEqual({ d: 38, c: "l1", k: null, cs: null, mn: null, mx: null, l: "" });
  });
});

describe("spec field round-trip (token payload)", () => {
  it("serializes + parses without the email", () => {
    const s = rocketSpecField(FIELDS);
    expect(s).not.toContain("@");
    expect(parseRocketSpecField(s)).toEqual(FIELDS);
  });
  it("round-trips class + case", () => {
    const f: RocketFields = { ...FIELDS, k: "J", cs: "RMS-54/1706" };
    expect(parseRocketSpecField(rocketSpecField(f))).toEqual(f);
  });
  it("is deterministic (stable key order)", () => {
    expect(rocketSpecField(FIELDS)).toBe(rocketSpecField({ ...FIELDS }));
  });
  it("rejects garbage", () => {
    expect(parseRocketSpecField("not json")).toBeNull();
    expect(parseRocketSpecField('{"d":"x"}')).toBeNull();
  });
  it("accepts a legacy spec without k/cs (defaults to null)", () => {
    // A token minted before class/case existed: no k/cs, cert present.
    const legacy = JSON.stringify({ d: 54, c: "l2", mn: 1000, mx: 5120, l: "Punisher" });
    expect(parseRocketSpecField(legacy)).toEqual(FIELDS);
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
  it("describes only the fields that are set", () => {
    expect(describeRocketFields(FIELDS)).toBe("54mm · L2 · 1000–5120 N·s");
    expect(describeRocketFields({ d: 38, c: "l1", k: null, cs: null, mn: 200, mx: null, l: "" })).toBe(
      "38mm · L1 · ≥200 N·s",
    );
    expect(describeRocketFields({ d: 75, c: "l3", k: null, cs: null, mn: null, mx: 9000, l: "" })).toBe(
      "75mm · L3 · ≤9000 N·s",
    );
    // class + case appear between cert and the band
    expect(
      describeRocketFields({ d: 54, c: "l2", k: "J", cs: "RMS-54/1706", mn: null, mx: null, l: "" }),
    ).toBe("54mm · L2 · class J · RMS-54/1706");
    // diameter-only
    expect(
      describeRocketFields({ d: 29, c: null, k: null, cs: null, mn: null, mx: null, l: "" }),
    ).toBe("29mm");
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
  it("class + case narrow the fit", () => {
    const spec = fieldsToSpec({ d: 54, c: null, k: "J", cs: "RMS-54/1706", mn: null, mx: null, l: "" });
    expect(
      motorFitsRocket(spec, {
        diameter_mm: 54,
        impulse_class: "J",
        total_impulse_ns: 1700,
        case_info: "RMS-54/1706",
        motor_type: "reload",
      }),
    ).toBe(true);
    // right case, wrong class
    expect(
      motorFitsRocket(spec, {
        diameter_mm: 54,
        impulse_class: "K",
        total_impulse_ns: 1700,
        case_info: "RMS-54/1706",
        motor_type: "reload",
      }),
    ).toBe(false);
    // right class, wrong case
    expect(
      motorFitsRocket(spec, {
        diameter_mm: 54,
        impulse_class: "J",
        total_impulse_ns: 1700,
        case_info: "RMS-54/852",
        motor_type: "reload",
      }),
    ).toBe(false);
  });

  it("a 'Single use' case pin matches an SU motor (depends on motor_type, not case_info)", () => {
    // Single-use motors carry no case_info, so the fit resolves the "Single use"
    // pseudo-case via motor_type === "SU". This guards the one alert path that
    // relies on motor_type: a future caseKey change here must not silently stop
    // SU-pinned rocket alerts from firing.
    const spec = fieldsToSpec({ d: 29, c: null, k: null, cs: SINGLE_USE_CASE, mn: null, mx: null, l: "" });
    expect(
      motorFitsRocket(spec, {
        diameter_mm: 29,
        impulse_class: "G",
        total_impulse_ns: 120,
        case_info: null,
        motor_type: "SU",
      }),
    ).toBe(true);
    // A reload of the same size is NOT single-use → no match.
    expect(
      motorFitsRocket(spec, {
        diameter_mm: 29,
        impulse_class: "G",
        total_impulse_ns: 120,
        case_info: "RMS-29/40",
        motor_type: "reload",
      }),
    ).toBe(false);
    // motor_type missing → SU pin can't resolve → no match (fail-closed).
    expect(
      motorFitsRocket(spec, {
        diameter_mm: 29,
        impulse_class: "G",
        total_impulse_ns: 120,
        case_info: null,
        motor_type: null,
      }),
    ).toBe(false);
  });
});

describe("shortHash", () => {
  it("is stable and hex", () => {
    expect(shortHash("abc")).toBe(shortHash("abc"));
    expect(shortHash("abc")).toMatch(/^[0-9a-f]+$/);
    expect(shortHash("abc")).not.toBe(shortHash("abd"));
  });
});
