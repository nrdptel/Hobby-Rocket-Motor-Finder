import type { MetadataRoute } from "next";

import { loadSnapshot } from "@/lib/snapshot";
import { MIN_CLASS, motorPath } from "@/lib/derive";

// Same origin the OG/Twitter cards resolve against (see layout.tsx). A fork sets
// NEXT_PUBLIC_SITE_URL on its deploy host to point the sitemap at its own domain.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://motor.fusionspace.co";

// Regenerate hourly so each fresh snapshot's `lastModified` flows through without
// a redeploy (snapshot commits are [skip ci], so they don't trigger one).
export const revalidate = 3600;

/** Sitemap of every indexable page: the catalog, the alerts manager, and one URL
 * per in-catalog motor detail page. Lists the exact same motor universe the
 * detail routes serve — has a listing and clears MIN_CLASS — so we never point
 * crawlers at a 404. Stock changes hourly, so the catalog + motor pages are
 * marked accordingly to invite re-crawls. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const snapshot = await loadSnapshot();
  const lastModified = snapshot ? new Date(snapshot.generated_at) : new Date();

  // /alerts is intentionally omitted — it's noindex (a private management page),
  // so advertising it in the sitemap would be a mixed signal to crawlers.
  const entries: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified, changeFrequency: "hourly", priority: 1 },
    { url: `${siteUrl}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];

  if (!snapshot) return entries;

  for (const m of snapshot.motors) {
    if (m.listings.length === 0 || m.impulse_class < MIN_CLASS) continue;
    entries.push({
      url: `${siteUrl}${motorPath(m)}`,
      lastModified,
      changeFrequency: "hourly",
      priority: 0.6,
    });
  }
  return entries;
}
