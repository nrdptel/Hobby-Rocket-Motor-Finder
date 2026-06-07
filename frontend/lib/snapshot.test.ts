import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SnapshotParseError, loadSnapshot } from "./snapshot";

// loadSnapshot resolves paths from process.cwd(). The frontend layout is
// `<cwd>/data/snapshot.json` and `<cwd>/data/snapshot.example.json`.
// In tests cwd === <repo>/frontend, so we point at frontend/data/.
const dataDir = path.resolve(process.cwd(), "data");
const livePath = path.join(dataDir, "snapshot.json");
const examplePath = path.join(dataDir, "snapshot.example.json");

let backupLive: string | null = null;
let backupExample: string | null = null;

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await (await import("node:fs/promises")).readFile(p, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function restoreOrRemove(p: string, original: string | null) {
  if (original === null) {
    await rm(p, { force: true });
  } else {
    await writeFile(p, original);
  }
}

beforeEach(async () => {
  // The prebuild script normally populates frontend/data; tests need to
  // mutate it freely without trashing the working copies the dev server
  // uses. Save and restore around each test.
  await mkdir(dataDir, { recursive: true });
  backupLive = await readIfExists(livePath);
  backupExample = await readIfExists(examplePath);
});

afterEach(async () => {
  await restoreOrRemove(livePath, backupLive);
  await restoreOrRemove(examplePath, backupExample);
});

describe("loadSnapshot", () => {
  it("prefers the live snapshot over the example seed", async () => {
    await writeFile(
      livePath,
      JSON.stringify({ generated_at: "live", motors: [], unmatched: [] }),
    );
    await writeFile(
      examplePath,
      JSON.stringify({ generated_at: "example", motors: [], unmatched: [] }),
    );
    const snap = await loadSnapshot();
    expect(snap?.generated_at).toBe("live");
  });

  it("falls back to the example seed when the live snapshot is missing", async () => {
    await rm(livePath, { force: true });
    await writeFile(
      examplePath,
      JSON.stringify({ generated_at: "example-only", motors: [], unmatched: [] }),
    );
    const snap = await loadSnapshot();
    expect(snap?.generated_at).toBe("example-only");
  });

  it("returns null when neither file exists", async () => {
    await rm(livePath, { force: true });
    await rm(examplePath, { force: true });
    expect(await loadSnapshot()).toBeNull();
  });

  it("throws SnapshotParseError when the live snapshot is malformed", async () => {
    await writeFile(livePath, "{not-json");
    // Even if the example seed is present, a present-but-malformed live file
    // is a real bug worth surfacing — don't silently fall back.
    await writeFile(
      examplePath,
      JSON.stringify({ generated_at: "example", motors: [], unmatched: [] }),
    );
    await expect(loadSnapshot()).rejects.toBeInstanceOf(SnapshotParseError);
  });

  it("includes the offending path in the parse error message", async () => {
    await writeFile(livePath, "{not-json");
    try {
      await loadSnapshot();
      throw new Error("expected loadSnapshot to throw");
    } catch (err) {
      expect((err as Error).message).toContain("snapshot.json");
    }
  });
});
