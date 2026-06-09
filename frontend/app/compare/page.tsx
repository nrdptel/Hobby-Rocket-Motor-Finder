import type { Metadata } from "next";
import Link from "next/link";

import { loadCatalogMotors, loadSnapshot } from "@/lib/snapshot";
import { mergedCatalog } from "@/lib/catalogMotors";
import { curveKey, loadCurves } from "@/lib/curves";
import { MIN_CLASS } from "@/lib/derive";
import { MAX_COMPARE } from "@/lib/compareSelection";
import { CompareView } from "../components/CompareView";
import { type CurveSeries } from "../components/ThrustCurveChart";
import { SiteHeader } from "../components/SiteHeader";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Compare motors — HPR Motor Finder",
  description: "Overlay the thrust curves and line up the specs of up to four high-power rocket motors side by side.",
  // A transient, selection-driven view — nothing universal to index.
  robots: { index: false, follow: false },
};

type SearchParamsRaw = Promise<{ ids?: string | string[] }>;

/** Parse ``?ids=1,2,3`` into a de-duplicated, capped list of motor ids in the
 * order given (URL order is the column order). */
function parseIds(raw: string | string[] | undefined): number[] {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s) return [];
  const out: number[] = [];
  for (const part of s.split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length >= MAX_COMPARE) break;
  }
  return out;
}

export default async function ComparePage({ searchParams }: { searchParams: SearchParamsRaw }) {
  const ids = parseIds((await searchParams).ids);
  const [snapshot, catalog, curves] = await Promise.all([
    loadSnapshot(),
    loadCatalogMotors(),
    loadCurves(),
  ]);

  const allMotors = snapshot ? mergedCatalog(snapshot.motors, catalog, MIN_CLASS) : [];
  const byId = new Map(allMotors.map((m) => [m.id, m]));
  // Resolve in URL order, skipping ids we don't recognize.
  const motors = ids.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => m != null);

  // Overlay only the motors that actually have a curve; the spec table still
  // covers every motor.
  const curveSeries: CurveSeries[] = [];
  motors.forEach((m, i) => {
    const pts = curves[curveKey(m.manufacturer, m.designation)];
    if (pts) curveSeries.push({ label: m.designation, points: pts, emphasis: i === 0 });
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-10">
      <SiteHeader />
      <nav className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
        <Link href="/" className="hover:text-zinc-800 dark:hover:text-zinc-200">
          ← All motors
        </Link>
      </nav>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Compare motors</h1>

      {motors.length < 2 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Pick 2–{MAX_COMPARE} motors to compare — tap{" "}
          <span className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Compare
          </span>{" "}
          next to a motor in the{" "}
          <Link href="/" className="underline hover:text-zinc-800 dark:hover:text-zinc-200">
            catalog
          </Link>
          , then open the tray.
        </p>
      ) : (
        <CompareView motors={motors} curveSeries={curveSeries} />
      )}
    </main>
  );
}
