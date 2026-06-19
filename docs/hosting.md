# Hosting (Cloudflare Pages: static export + Pages Functions)

The catalog is served as **static assets on Cloudflare Pages** (unlimited
requests + bandwidth, free), and only the genuinely-dynamic surface runs as
**Pages Functions** (Workers, 100k invocations/day free — alerts are
human-action volume, OG is pre-generated to static).

Page views never invoke a Function, so the only Cloudflare free-tier limit that
could bite us — the Workers 100k req/day cap — stays well out of reach.

## Architecture

| Surface | How it's served |
|---|---|
| `/`, `/plan`, `/motor/[…]`, `/alerts`, `/privacy`, `/compare` shell | **static export** (`out/`), served as Pages static assets |
| `/compare?ids=…` | **client-rendered** from a static catalog JSON |
| OG images | **pre-generated PNGs** at build (`scripts/gen-og.mjs`) → static assets |
| `/api/alerts/*` (9 routes) | **Pages Functions** (`functions/api/alerts/*`) over the shared `lib/alerts/*` |
| Data refresh | hourly scrape commit → GitHub Actions build + `wrangler pages deploy` |

Externals: cron-job.org (hits the GH Actions dispatch), Upstash Redis
(REST/fetch), ZeptoMail (fetch). Subscriber state lives in Upstash, so a host
move needs no data migration — just matching `ALERTS_SECRET` /
`ALERTS_DISPATCH_SECRET` between the deploy env and the scrape's GH Actions
secrets.

## How the pieces fit

- **`next.config`**: `output: "export"`, `images.unoptimized: true`. Security
  headers live in `public/_headers` (not a `headers()` block, which export
  can't emit). No `next/image` loader or middleware that would block export.
- **`public/_headers`** — the security headers.
- **`public/_redirects`** — legacy `/compare/<ids>` path links 302 to the
  `/compare?ids=…` query form (the query form survives the redirect; a
  `.html`→clean-URL redirect on the path form would loop). Uses a named
  placeholder (`:ids`), since Cloudflare leaves a `:splat` literal in a
  query-string destination.
- **Pages Functions** (`functions/api/alerts/*`) export `onRequestPost` /
  `onRequestGet` and wrap the runtime-agnostic `lib/alerts/*` (fetch + Web
  Crypto). Env comes from the Functions `env` binding, not `process.env`.
  Cloudflare routes any `/api/*` request to these Functions and serves
  everything else as a static asset automatically — no `_routes.json` needed.
- **GitHub Actions deploy** (`.github/workflows/deploy-cloudflare.yml`) builds
  with the `NEXT_PUBLIC_*` vars present, then
  `wrangler pages deploy out --project-name <proj>`. Direct upload, so it
  doesn't consume the 500/mo Cloudflare build quota.

## Free-tier limits we design around

- Pages static requests + bandwidth: **unlimited**.
- Pages builds: 500/mo — avoided (we build in Actions, direct-upload).
- Files per deployment: **20,000** (≈2–4k now; watch as the catalog grows).
- Functions (Workers): **100k/day**, **10ms CPU**, **3MB** bundle — alerts only,
  low volume; never bundle the ~2MB snapshot into a Function.
