# Frontend — HPR Motor Finder

The [Next.js](https://nextjs.org) (App Router) web app. It renders a static
catalog of high-power rocket motors from a snapshot the Python backend produces,
plus the optional restock email-alert API routes.

See the top-level [README](../README.md) for the project overview and the
architecture, and [docs/email-alerts.md](../docs/email-alerts.md) for the alert
backend setup.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the result. The
`prebuild`/`predev` scripts copy the latest snapshot from `../data` and
pre-generate Open Graph cards, so a fresh clone renders the seed catalog with no
extra setup. Edit pages under `app/`; they hot-reload as you save.

## Build & test

```bash
npm run build      # static export to ./out (output: "export")
npm test           # vitest unit tests (lib/**)
npm run test:e2e   # Playwright e2e against the exported ./out
```

## Deploying

The app is a static export (`out/`) served by **Cloudflare Pages**, with the
alert API routes running as **Pages Functions** (`functions/`). The hourly
scrape commits a fresh snapshot, and a GitHub Actions workflow rebuilds and runs
`wrangler pages deploy`. See [docs/hosting.md](../docs/hosting.md)
for the hosting layout.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs) — Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) — an interactive Next.js tutorial.
