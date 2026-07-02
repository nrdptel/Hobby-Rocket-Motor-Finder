"use client";

import Link from "next/link";

import { MAX_COMPARE } from "@/lib/compareSelection";
import type { Motor } from "@/lib/snapshotTypes";
import { CompareView } from "./CompareView";
import { type CurveSeries } from "./ThrustCurveChart";
import { SiteHeader } from "./SiteHeader";

/** Shared body for the compare routes: the static empty-state shell when fewer
 * than two motors resolve, or the side-by-side CompareView otherwise. Server
 * component, so it works for both the static bare /compare page and the
 * ISR-cached /compare/<ids> page. */
export function ComparePageBody({
  motors,
  curveSeries,
}: {
  motors: Motor[];
  curveSeries: CurveSeries[];
}) {
  // Container width is deliberate, not arbitrary. This holds the widest view in
  // the app — a 4-motor (MAX_COMPARE) side-by-side plus an overlaid thrust-curve
  // chart — yet max-w-5xl (1024px) was verified comfortable at 1440/1920: the
  // curves stay large and legible and the columns are roomy, not cramped.
  // Widening to 6xl/7xl only pads already-spacious cells, so it stays 5xl. On
  // mobile the table + curve scroll inside their own overflow-x-auto (no page
  // scroll); raising a max-w can't affect narrower viewports anyway.
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
