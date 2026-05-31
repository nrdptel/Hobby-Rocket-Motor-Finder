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

const files = ["snapshot.json", "snapshot.example.json"];

await mkdir(targetDir, { recursive: true });

for (const name of files) {
  const src = resolve(sourceDir, name);
  const dst = resolve(targetDir, name);
  try {
    await access(src);
    await copyFile(src, dst);
    console.log(`copy-snapshot: ${name} → frontend/data/`);
  } catch (err) {
    if (err.code === "ENOENT") {
      // OK for live snapshot.json on a fresh clone; the example seed
      // alone is enough for `npm run dev` to work.
      console.log(`copy-snapshot: ${name} not present, skipping`);
    } else {
      throw err;
    }
  }
}
