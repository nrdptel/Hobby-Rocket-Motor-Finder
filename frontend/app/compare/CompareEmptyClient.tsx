"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { ComparePageBody } from "../components/ComparePageBody";

// Client body for the bare /compare page: the pick-motors empty-state shell, plus
// a backward-compat redirect from the old query form (/compare?ids=1,2,3 →
// /compare/1,2,3). Kept in a client component so ComparePageBody (which is
// "use client", to stay fs-free for static export) is only ever in the client
// graph — importing it from a server component drags lib/snapshot's fs loader
// into the client chunk under Turbopack's merged-module chunking.
export function CompareEmptyClient() {
  const router = useRouter();
  useEffect(() => {
    const ids = new URLSearchParams(window.location.search).get("ids");
    if (ids) router.replace(`/compare/${ids}`);
  }, [router]);
  return <ComparePageBody motors={[]} curveSeries={[]} />;
}
