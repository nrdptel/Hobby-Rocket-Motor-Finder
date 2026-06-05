# Hobby Rocket Motor Finder

A web aggregator for U.S. high-power rocketry (HPR) motor availability across multiple vendors.

**Live at [motor.fusionspace.co](https://motor.fusionspace.co).**

The U.S. hobby motor shortage makes finding a specific impulse / diameter / propellant motor difficult — flyers often check each vendor manually. This project scrapes a curated set of vendors on a schedule, normalizes their listings against a canonical motor catalog ([ThrustCurve.org](https://www.thrustcurve.org)), and presents a single searchable view of stock status by motor.

## Disclaimer

Personal, non-commercial hobby project. Not affiliated with any vendor or manufacturer listed. Stock and price data are best-effort, often stale, and not authoritative — always confirm on the vendor's own site before purchasing. If you operate a listed vendor and would like the scraper changed or removed, please [open an issue](https://github.com/nrdptel/Hobby-Rocket-Motor-Finder/issues) and we'll comply.

Released under the [MIT License](LICENSE) — fork it, modify it, deploy your own copy, no attribution required.

## What's covered

Today: AeroTech across six vendors, Cesaroni (CTI) on Chris' Rocket Supplies, Wildman Rocketry, and Performance Hobbies, and Loki Research direct from the manufacturer plus Performance Hobbies.

| Vendor | State | Platform | Motors |
|---|---|---|---|
| [Chris' Rocket Supplies](https://www.csrocketry.com) | GA | Custom (Schema.org JSON-LD) | AeroTech, Cesaroni |
| [BuyRocketMotors](https://www.buyrocketmotors.com) | TX | Shopify | AeroTech |
| [Wildman Rocketry](https://wildmanrocketry.com) | IL | Shopify | AeroTech, Cesaroni |
| [Animal Motor Works](https://cart.amwprox.com) | AZ | VirtueMart | AeroTech |
| [Sirius Rocketry](https://www.siriusrocketry.biz) | WI | Zen Cart | AeroTech |
| [Loki Research](https://lokiresearch.com) | MO | Custom (ASP store) | Loki |
| [Performance Hobbies](https://performancehobbies.com) | VA | Custom (ASP.NET store) | AeroTech, Cesaroni, Loki |

The architecture isn't motor-specific — see [Adding a vendor](#adding-a-vendor) and [Extending beyond motors](#extending-beyond-motors) if you want to grow it.

## Running locally

You need Python 3.12+ and Node 20+.

```sh
# Backend (scraper + catalog + CLI)
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'

# Frontend (Next.js UI)
cd ../frontend
npm install
npm run dev          # http://localhost:3000 — uses snapshot.example.json out of the box
```

To run a real scrape against live vendors:

```sh
cd backend
hpr catalog refresh         # download AeroTech subset of ThrustCurve
hpr scrape run all          # ~5-10 min across all 7 vendors
hpr snapshot export         # writes data/snapshot.json
```

After that, `npm run dev` will pick up `snapshot.json` automatically (preferred over the example seed).

## Architecture

```
┌───────────────────┐    cron     ┌──────────────────┐
│  vendor websites  │ ──────────▶ │ backend scrapers │
└───────────────────┘             └────────┬─────────┘
                                           │ Listings
                                           ▼
                                  ┌──────────────────┐
                                  │ SQLite (hpr.db)  │
                                  └────────┬─────────┘
                                           │ snapshot export
                                           ▼
                                  ┌──────────────────┐
                                  │  snapshot.json   │
                                  └────────┬─────────┘
                                           │ read at build/request
                                           ▼
                                  ┌──────────────────┐
                                  │ Next.js frontend │
                                  └──────────────────┘
```

Key pieces:

- [backend/hpr_finder/normalize.py](backend/hpr_finder/normalize.py) — turn vendor product titles into canonical AeroTech designations (e.g. `D13-10W` ↔ `D13W`).
- [backend/hpr_finder/db.py](backend/hpr_finder/db.py) — `find_motor_id` runs a fallback chain of designation transforms to match listings against the ThrustCurve catalog. Currently 99%+ match rate.
- [backend/hpr_finder/scrapers/](backend/hpr_finder/scrapers/) — one file per vendor; each implements the `Scraper` protocol and returns a list of `Listing`. Discovery strategies vary (Shopify `vendor=AEROTECH` filter, VirtueMart category sweep, Zen Cart manufacturer-page pagination).
- [backend/hpr_finder/http.py](backend/hpr_finder/http.py) — `PoliteAsyncClient` enforces per-host concurrency cap + minimum-interval pacing + `Retry-After` honoring.
- [frontend/lib/snapshot.ts](frontend/lib/snapshot.ts) — the only contract between backend and frontend. If `data/snapshot.json` exists it wins; otherwise the loader falls back to the tracked `data/snapshot.example.json`. A `predev`/`prebuild` script ([frontend/scripts/copy-snapshot.mjs](frontend/scripts/copy-snapshot.mjs)) copies both files into `frontend/data/` because Next 16 + Turbopack refuses to bundle files from outside the project root.

## Adding a vendor

1. Add a scraper at `backend/hpr_finder/scrapers/<slug>.py` implementing `Scraper.scrape()`. Look at [csrocketry.py](backend/hpr_finder/scrapers/csrocketry.py) (Schema.org JSON-LD) or [sirius.py](backend/hpr_finder/scrapers/sirius.py) (Zen Cart manufacturer-page paginator) as templates.
2. Register it in [backend/hpr_finder/scrapers/__init__.py](backend/hpr_finder/scrapers/__init__.py).
3. Verify the vendor's [robots.txt](https://en.wikipedia.org/wiki/Robots.txt) permits crawling and set conservative `max_concurrent_per_host` / `min_start_interval_s` on the scraper class.
4. Run `hpr scrape run <slug>` and check the match rate; tune `normalize.py` if their title format trips the regex.

## Extending beyond motors

The data model is generic: a `Listing` is `{vendor, designation, sku, status, price, url}`. To support kits, electronics, recovery, etc., add a `product_type` to `Listing` / `Motor`, generalize the catalog table, and broaden `extract_designation`. The scraping infrastructure (polite client, scheduling, snapshot contract, normalize fallback chain) doesn't change.

## Deploying

Free hosting works since the architecture is essentially a static site fed by a periodic snapshot.

- **Frontend**: Cloudflare Pages or Vercel Hobby — auto-deploy on `git push`.
- **Scrapes**: GitHub Actions cron, e.g. every 6h: run `hpr scrape run all && hpr snapshot export`, upload `snapshot.json` as a build artifact, trigger a frontend deploy.

A test workflow lives at [.github/workflows/test.yml](.github/workflows/test.yml). A deploy workflow is left as an exercise — pick the host you prefer.

For OpenGraph / Twitter share cards, the site origin defaults to the production domain (`https://motor.fusionspace.co`). If you deploy your own copy, set `NEXT_PUBLIC_SITE_URL` to your deployed origin so card image URLs resolve to your domain instead.

## Scraping ethics

This project scrapes vendors without prior permission. The bar we hold ourselves to:

- **Identify ourselves.** The `User-Agent` includes the project URL and a contact channel ([GitHub Issues](https://github.com/nrdptel/Hobby-Rocket-Motor-Finder/issues)).
- **Honor `robots.txt`.** Vendors that disallow generic crawlers are not scraped.
- **Rate limit.** Per-host concurrency cap (typically 2-4) and minimum interval between request starts (0.25-1s) — see each scraper's class attributes.
- **Honor `Retry-After`.** On 429/503 we sleep the full duration before continuing.
- **No evasion.** No rotating User-Agents, no residential proxies, no captcha solvers. If a vendor blocks us, we stop.
- **Take down on request.** Open an issue and we comply, no questions asked.

## Layout

```
backend/                Python scraper, normalizer, SQLite store, CLI
frontend/               Next.js UI (App Router, TypeScript, Tailwind)
data/                   Runtime data
  snapshot.example.json   tracked, frozen reference for `npm run dev`
  snapshot.json           gitignored, generated by `hpr snapshot export`
  thrustcurve_aerotech.json  tracked, refreshed via `hpr catalog refresh`
docs/                   Research notes and the original vendor directory
.github/workflows/      CI (pytest + next build)
```

## License

[MIT](LICENSE).
