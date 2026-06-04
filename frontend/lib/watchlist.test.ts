import { describe, expect, it } from "vitest";

import { parseWatchlist, serializeWatchlist, toggleId } from "./watchlist";

// The localStorage / useSyncExternalStore glue is client-only and verified in
// the browser; these cover the pure logic the store is built on.

describe("parseWatchlist", () => {
  it("parses a JSON array of motor ids", () => {
    expect(parseWatchlist("[3, 7, 42]")).toEqual([3, 7, 42]);
  });

  it("returns [] for null/empty (nothing persisted yet)", () => {
    expect(parseWatchlist(null)).toEqual([]);
    expect(parseWatchlist("")).toEqual([]);
  });

  it("returns [] for malformed JSON rather than throwing", () => {
    expect(parseWatchlist("{not json")).toEqual([]);
    expect(parseWatchlist("not json at all")).toEqual([]);
  });

  it("returns [] when the payload is not an array", () => {
    expect(parseWatchlist('{"a":1}')).toEqual([]);
    expect(parseWatchlist("42")).toEqual([]);
  });

  it("drops non-numeric / non-finite entries", () => {
    expect(parseWatchlist('[1, "2", null, 3, true]')).toEqual([1, 3]);
  });
});

describe("serializeWatchlist", () => {
  it("emits a sorted JSON array for stable output", () => {
    expect(serializeWatchlist(new Set([7, 3, 42]))).toBe("[3,7,42]");
  });

  it("round-trips through parseWatchlist", () => {
    const ids = new Set([10, 2, 5]);
    expect(new Set(parseWatchlist(serializeWatchlist(ids)))).toEqual(ids);
  });

  it("serializes an empty set", () => {
    expect(serializeWatchlist(new Set())).toBe("[]");
  });
});

describe("toggleId", () => {
  it("adds an id that is absent", () => {
    expect(toggleId(new Set([1, 2]), 3)).toEqual(new Set([1, 2, 3]));
  });

  it("removes an id that is present", () => {
    expect(toggleId(new Set([1, 2, 3]), 2)).toEqual(new Set([1, 3]));
  });

  it("does not mutate the input set", () => {
    const input = new Set([1, 2]);
    toggleId(input, 3);
    expect(input).toEqual(new Set([1, 2]));
  });
});
