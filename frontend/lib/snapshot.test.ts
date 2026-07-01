import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SnapshotParseError, loadSnapshot } from "./snapshot";

// loadSnapshot reads `<dataDir>/snapshot.json` then `<dataDir>/snapshot.example.json`.
// Each test gets its OWN throwaway temp dir (passed to loadSnapshot) and writes
// only there — so the suite never mutates the real frontend/data/ working copies
// the dev server reads, and a crash mid-test can't corrupt them or race a
// concurrent reader in another test file.
let dir: string;
const live = () => path.join(dir, "snapshot.json");
const example = () => path.join(dir, "snapshot.example.json");

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "hpr-snapshot-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadSnapshot", () => {
  it("prefers the live snapshot over the example seed", async () => {
    await writeFile(live(), JSON.stringify({ generated_at: "live", motors: [], unmatched: [] }));
    await writeFile(example(), JSON.stringify({ generated_at: "example", motors: [], unmatched: [] }));
    const snap = await loadSnapshot(dir);
    expect(snap?.generated_at).toBe("live");
  });

  it("falls back to the example seed when the live snapshot is missing", async () => {
    await writeFile(
      example(),
      JSON.stringify({ generated_at: "example-only", motors: [], unmatched: [] }),
    );
    const snap = await loadSnapshot(dir);
    expect(snap?.generated_at).toBe("example-only");
  });

  it("returns null when neither file exists", async () => {
    expect(await loadSnapshot(dir)).toBeNull();
  });

  it("throws SnapshotParseError when the live snapshot is malformed", async () => {
    await writeFile(live(), "{not-json");
    // Even if the example seed is present, a present-but-malformed live file
    // is a real bug worth surfacing — don't silently fall back.
    await writeFile(example(), JSON.stringify({ generated_at: "example", motors: [], unmatched: [] }));
    await expect(loadSnapshot(dir)).rejects.toBeInstanceOf(SnapshotParseError);
  });

  it("includes the offending path in the parse error message", async () => {
    await writeFile(live(), "{not-json");
    try {
      await loadSnapshot(dir);
      throw new Error("expected loadSnapshot to throw");
    } catch (err) {
      expect((err as Error).message).toContain("snapshot.json");
    }
  });
});
