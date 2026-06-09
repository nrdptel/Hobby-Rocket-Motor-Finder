import { describe, expect, it } from "vitest";

import {
  MAX_COMPARE,
  parseCompare,
  serializeCompare,
  toggleCompareId,
} from "./compareSelection";

describe("parseCompare", () => {
  it("reads a JSON array of ids", () => {
    expect(parseCompare("[3,1,2]")).toEqual([3, 1, 2]);
  });
  it("returns [] for absent/empty/corrupt input", () => {
    expect(parseCompare(null)).toEqual([]);
    expect(parseCompare("")).toEqual([]);
    expect(parseCompare("not json")).toEqual([]);
    expect(parseCompare('{"a":1}')).toEqual([]);
  });
  it("drops non-finite/non-number entries", () => {
    expect(parseCompare('[1,"x",2,null,3.5]')).toEqual([1, 2, 3.5]);
  });
  it("caps to MAX_COMPARE", () => {
    expect(parseCompare("[1,2,3,4,5,6]")).toHaveLength(MAX_COMPARE);
    expect(parseCompare("[1,2,3,4,5,6]")).toEqual([1, 2, 3, 4]);
  });
});

describe("serializeCompare", () => {
  it("sorts numerically for stable output", () => {
    expect(serializeCompare(new Set([3, 1, 2]))).toBe("[1,2,3]");
  });
  it("round-trips with parseCompare", () => {
    const ids = new Set([5, 9, 1]);
    expect(new Set(parseCompare(serializeCompare(ids)))).toEqual(ids);
  });
});

describe("toggleCompareId", () => {
  it("adds an absent id", () => {
    expect([...toggleCompareId(new Set([1]), 2)]).toEqual([1, 2]);
  });
  it("removes a present id", () => {
    expect([...toggleCompareId(new Set([1, 2]), 2)]).toEqual([1]);
  });
  it("refuses to add past the cap, but still removes", () => {
    const full = new Set([1, 2, 3, 4]);
    // adding a 5th is a no-op (same membership)
    expect(toggleCompareId(full, 5)).toEqual(full);
    // removing one still works even at capacity
    expect([...toggleCompareId(full, 2)].sort()).toEqual([1, 3, 4]);
  });
  it("does not mutate the input set", () => {
    const ids = new Set([1]);
    toggleCompareId(ids, 2);
    expect([...ids]).toEqual([1]);
  });
  it("honors a custom max", () => {
    expect(toggleCompareId(new Set([1, 2]), 3, 2)).toEqual(new Set([1, 2]));
  });
});
