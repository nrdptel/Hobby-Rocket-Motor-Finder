"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Backward-compat for the old query form: redirects /compare?ids=1,2,3 to the
 * new /compare/1,2,3 path (which is ISR-cached per comparison). Renders nothing;
 * runs once on mount. New links are emitted in the path form directly, so this
 * only fires for links shared before the change. */
export function LegacyCompareRedirect() {
  const router = useRouter();
  useEffect(() => {
    const ids = new URLSearchParams(window.location.search).get("ids");
    if (ids) router.replace(`/compare/${ids}`);
  }, [router]);
  return null;
}
