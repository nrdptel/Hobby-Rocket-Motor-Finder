// Copy the latest snapshot files from ../data/ into frontend/data/ so the
// Next runtime can read them. We have to copy (vs. read directly across
// the project boundary) because Next 16 + Turbopack refuses file traces
// outside the project root — production deploys would otherwise ship
// without the snapshot and the page would render "No snapshot yet."
//
// Runs automatically as `predev` and `prebuild`. Idempotent and tolerant
// of missing files (a fresh contributor may only have the example seed).
import { copyFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(here, "..", "..", "data");
const targetDir = resolve(here, "..", "data");

// Each entry is { src (relative to ../data), dst (relative to frontend/data) }.
// The history summary lives in a subdir but is flattened on the Next side so the
// loader reads one flat file, matching how snapshot.json is read today.
const files = [
  { src: "snapshot.json", dst: "snapshot.json" },
  { src: "snapshot.example.json", dst: "snapshot.example.json" },
  { src: "history/summary.json", dst: "history-summary.json" },
  { src: "history/log.json", dst: "history-log.json" },
];

await mkdir(targetDir, { recursive: true });

for (const { src: srcName, dst: dstName } of files) {
  const src = resolve(sourceDir, srcName);
  const dst = resolve(targetDir, dstName);
  try {
    await access(src);
    await copyFile(src, dst);
    console.log(`copy-snapshot: ${srcName} → frontend/data/${dstName}`);
  } catch (err) {
    if (err.code === "ENOENT") {
      // OK on a fresh clone: the example seed alone runs `npm run dev`, and the
      // history summary is an optional overlay produced by `hpr history`.
      console.log(`copy-snapshot: ${srcName} not present, skipping`);
    } else {
      throw err;
    }
  }
}
