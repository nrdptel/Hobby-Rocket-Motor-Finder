# Cloudflare migration (Path B: static export → Cloudflare Pages)

Goal: serve the catalog as **static assets on Cloudflare Pages** (unlimited
requests + bandwidth, free) and run only the genuinely-dynamic surface as
**Pages Functions** (Workers, 100k invocations/day free — alerts are
human-action volume, OG is pre-generated to static).

This removes the only Cloudflare free-tier limit that could bite us — the
Workers 100k req/day cap — because page views never invoke a Function.

## End-state architecture

| Surface | Today (Vercel) | After (Cloudflare) |
|---|---|---|
| `/`, `/plan`, `/motor/[…]`, `/alerts`, `/privacy`, `/compare` shell | static / ISR | **static export** (`out/`), served as Pages static assets |
| `/compare/[ids]` | dynamic server render (fs) | **client-rendered** from a static catalog JSON |
| OG images | dynamic `next/og` (fs) | **pre-generated PNGs** at build → static assets |
| `/api/alerts/*` (9) | Next route handlers | **Pages Functions** (`functions/api/alerts/*`) over the same `lib/alerts/*` |
| Data refresh | hourly scrape commit → Vercel auto-deploy | hourly scrape commit → GitHub Actions build + `wrangler pages deploy` |

Unchanged externals: cron-job.org (hits GH Actions dispatch), Upstash Redis
(REST/fetch), ZeptoMail (fetch). Subscriber state lives in Upstash, so cutover
needs no data migration — just matching `ALERTS_SECRET` / `ALERTS_DISPATCH_SECRET`.

## Engineering checklist (my side)

- [ ] **Compare → client render.** Ship a static `compare/[ids]` shell; a client
      component reads ids from the URL and renders from a static catalog+curves
      JSON. Removes the runtime-`fs` dependency. (Verify: e2e `compare.spec`.)
- [ ] **Pre-generate OG images** at build into `public/og/...`; point the
      `openGraph.images` metadata at the static PNGs; drop the dynamic
      `opengraph-image.tsx` routes. (Verify: PNGs exist, pages reference them.)
- [ ] **Move `/api/alerts/*` to `functions/api/alerts/*`** as Pages Functions
      (`onRequestPost`/`onRequestGet`) wrapping the existing `lib/alerts/*`
      logic (already fetch + Web Crypto, runtime-agnostic). Env via the Functions
      `env` binding. (Verify: on the CF preview — needs Phase 0 done.)
- [ ] **`next.config`**: `output: "export"`, `images.unoptimized: true`, drop the
      `headers()` block (move to `_headers`). Confirm no `next/image` loader or
      middleware blocks export.
- [ ] **`_headers`** file with the security headers currently in `next.config`.
- [ ] **`_routes.json`** so static asset paths never invoke a Function.
- [ ] **GitHub Actions deploy**: build with `NEXT_PUBLIC_*` present →
      `wrangler pages deploy out --project-name <proj>`; run after the scrape
      commit. Direct upload, so it doesn't consume the 500/mo CF build quota.
- [ ] **Verify** full unit + e2e green against the static build, then a CF
      preview soak test (alerts end-to-end, OG unfurls, compare).

## Free-tier limits we are designing around

- Pages static requests + bandwidth: **unlimited**.
- Pages builds: 500/mo — avoided (we build in Actions, direct-upload).
- Files per deployment: **20,000** (≈2–4k now; watch as catalog grows).
- Functions (Workers): **100k/day**, **10ms CPU**, **3MB** bundle — alerts only,
  low volume; never bundle the 2MB snapshot into a Function.
