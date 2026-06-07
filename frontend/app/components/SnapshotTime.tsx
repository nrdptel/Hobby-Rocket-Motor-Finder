"use client";

import { useEffect, useState } from "react";

const PARTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

// Deterministic UTC rendering for SSR + the first client paint (pinned locale +
// timeZone, so server HTML and the hydration render match exactly).
const utc = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { ...PARTS, timeZone: "UTC" });

// The viewer's local timezone — only correct on the client, where we know it.
const local = (iso: string) => new Date(iso).toLocaleString(undefined, PARTS);

/** Renders an ISO timestamp in the *viewer's* local timezone with an explicit
 * zone label (e.g. "Jun 3, 2026, 9:01 PM CDT"). The timestamp is otherwise
 * formatted server-side, which means it would show the server's zone (UTC on
 * Vercel) to everyone; this fixes that by reformatting after mount. Falls back
 * to a clearly-labelled UTC value before hydration. */
export function SnapshotTime({ iso }: { iso: string }) {
  const [text, setText] = useState(() => utc(iso));
  useEffect(() => {
    setText(local(iso));
  }, [iso]);
  return (
    <time dateTime={iso} title={utc(iso)} suppressHydrationWarning>
      {text}
    </time>
  );
}
