import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://motor.fusionspace.co";

// Static export emits a static robots.txt at build time.
export const dynamic = "force-static";

/** Allow crawling everything user-facing — including the /api docs page and the
 * public read-only data API (/api/v1/*) — and keep bots out only of the alert
 * API routes (/api/alerts/*: nothing to index, and they mutate state). Point
 * crawlers at the sitemap. (A blanket `/api/` disallow would also hide the
 * public data API, which we want discoverable.) */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/alerts/" },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
