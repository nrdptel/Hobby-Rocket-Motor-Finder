# Hobby Rocket Motor Finder

A web aggregator for U.S. high-power rocketry (HPR) motor availability across multiple vendors.

**Live at [motor.fusionspace.co](https://motor.fusionspace.co).**

The U.S. hobby motor shortage makes finding a specific impulse / diameter / propellant motor difficult — flyers often check each vendor manually. This project scrapes a curated set of vendors on a schedule, normalizes their listings against a canonical motor catalog ([ThrustCurve.org](https://www.thrustcurve.org)), and presents a single searchable view of stock status by motor — and when a motor is sold out everywhere, points you to comparable in-stock substitutes you could fly instead.

## Features

- **One searchable view** of live stock and pricing for AeroTech, Cesaroni, and Loki across U.S. vendors, each listing matched to a canonical [ThrustCurve](https://www.thrustcurve.org) motor. The full catalog ships to the browser, so **search, filtering, and sorting are instant** — no round-trip per click.
- **Filter and sort** by impulse class, diameter, total-impulse range, certification level (L1–L3), manufacturer, vendor, propellant, reload case, and in-stock-only; sort by class, impulse, thrust, diameter, or cheapest in-stock price. Every filter lives in the URL, so any view is shareable.
- **Per-motor detail pages** (`/motor/<mfr>/<designation>`) — full specs, every vendor's price and stock side by side, an **availability history** (how often the motor's been buyable since the scrape cadence became reliable, with a per-vendor in-stock/out timeline), similar in-stock motors, and a link to the ThrustCurve thrust curve; each carries `Product`/`Offer` structured data and a generated social card.
- **In-stock substitutes** — when a motor is sold out at every vendor, surfaces comparable in-stock motors you could fly instead: same diameter and impulse class, total impulse within ±15% and average thrust within ±35%, ranked by closest fit.
- **My Rockets** — save a rocket by its motor-mount diameter (the only required field), optionally pinning a cert level, impulse class, reload case, and/or total-impulse band; each shows how many in-stock motors fit it, and one tap opens a **"fly it" loadout** — the in-stock motors that fit (cheapest first), one tap to add them all to a Plan order, and the closest buyable swaps when nothing that fits is in stock.
- **Plan your order** — star the motors you want, then get the cheapest way to buy them all across vendors: set a quantity per motor and an estimated shipping/HAZMAT cost per order, and it minimizes motor cost + shipping × number of shipments. When a motor on your list is sold out everywhere, it surfaces in-stock swaps you can add in one tap to keep the order buyable. The plan is shareable as a link (re-priced live for whoever opens it) and exportable as plain text.
- **Restock email alerts** — get notified when a specific motor, or anything that fits a saved rocket, comes back in stock ([setup](docs/email-alerts.md)).
- **History-powered buying signals** — a catalog badge flags motors that are *in stock now but rarely are* (grab it) vs. *often out* (the scarcity verdict only fires once a motor has been tracked for several days, and never on discontinued stock); each **in-stock** listing's price gets a marker vs. its own tracked history (`↓ lowest tracked` / `↓ price dropped` / `↑ above its low`). Cadence-sensitive stats are clipped to the reliable-scrape epoch; price min/max isn't, so it uses full history with a noise guard.
- **Restock & last-in-stock history** plus **best-price-across-vendors**, derived from successive hourly snapshots.
- **Scrape-health monitoring** — catches silent breakages (carry-forward, sustained staleness, below-baseline count / in-stock / match-rate anomalies, and a registered vendor contributing zero listings) and opens a single auto-closing tracking issue ([details](docs/scrape-health.md)).
- Plus a ★ watchlist, dark mode, and an on-page explainer of exactly how every figure is derived. Interactive behavior is covered by a headless-browser (Playwright) end-to-end suite in CI.

## Disclaimer

Personal, non-commercial hobby project. Not affiliated with any vendor or manufacturer listed. Stock and price data are best-effort, often stale, and not authoritative — always confirm on the vendor's own site before purchasing. If you operate a listed vendor and would like the scraper changed or removed, please [open an issue](https://github.com/nrdptel/Hobby-Rocket-Motor-Finder/issues) and we'll comply.

Released under the [MIT License](LICENSE) — fork it, modify it, deploy your own copy, no attribution required.

## What's covered

Today: AeroTech across ten vendors (including manufacturer-direct from AeroTech itself); Cesaroni (CTI) on Chris' Rocket Supplies, Wildman Rocketry, Performance Hobbies, and Moto-Joe Rocketry; and Loki Research direct from the manufacturer and via Performance Hobbies.

| Vendor | State | Platform | Motors |
|---|---|---|---|
| [Chris' Rocket Supplies](https://www.csrocketry.com) | GA | Custom (Schema.org JSON-LD) | AeroTech, Cesaroni |
| [BuyRocketMotors](https://www.buyrocketmotors.com) | TX | Shopify | AeroTech |
| [Wildman Rocketry](https://wildmanrocketry.com) | IL | Shopify | AeroTech, Cesaroni |
| [Animal Motor Works](https://cart.amwprox.com) | AZ | VirtueMart | AeroTech |
| [Sirius Rocketry](https://www.siriusrocketry.biz) | WI | Zen Cart | AeroTech |
| [Loki Research](https://lokiresearch.com) | MO | Custom (ASP store) | Loki |
| [Performance Hobbies](https://performancehobbies.com) | VA | Custom (ASP.NET store) | AeroTech, Cesaroni, Loki |
| [AeroTech (direct)](https://aerotech-rocketry.com) | UT | Shopify | AeroTech (manufacturer-direct) |
| [Moto-Joe Rocketry](https://www.moto-joe.com) | — | OpenCart | AeroTech, Cesaroni |
| [Balsa Machining Service](https://www.balsamachining.com) | NV | Custom (single-page ASP) | AeroTech |
| [eRockets](https://www.erockets.biz) | OH | BigCommerce | AeroTech (low/mid-power) |

AeroTech currently backorders nearly everything rather than holding stock, and their store doesn't expose real inventory — so AeroTech-direct listings are shown as **special-order with a fulfillment lead-time** (e.g. "special order · ~16–20 weeks"), parsed live from AeroTech's own published lead-time banner, rather than as "in stock."

> **eRockets** is scraped, but its host currently blocks the GitHub Actions data-center IPs (it works fine from residential IPs), so in production it contributes **no live listings** — the site effectively shows ten vendors today. The scrape-health report flags it as a zero-coverage vendor rather than letting it vanish silently; it would self-recover if the block lifts or the scrape runs from a different host.

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
hpr catalog refresh         # download AeroTech, Cesaroni, and Loki motors from ThrustCurve
hpr scrape run all          # ~5-10 min across all 11 vendors
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
- **Honor `robots.txt`.** Each vendor's `robots.txt` is reviewed before the vendor is added; those that disallow generic crawlers are excluded (e.g. Apogee Components, Miller Motor Works — see [the vendor report](docs/HPR_Vendor_Report.md)). This is a manual check at onboarding, not a runtime fetch.
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
.github/workflows/      CI (pytest, vitest, next build, Playwright e2e) + hourly scrape
```

## License

[MIT](LICENSE).
