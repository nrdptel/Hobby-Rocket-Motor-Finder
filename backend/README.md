# hpr-finder (backend)

Python scraper, normalizer, and SQLite store for the HPR motor aggregator.

## Setup

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
```

## CLI

```sh
hpr catalog refresh         # download AeroTech subset of the ThrustCurve catalog
hpr scrape csrocketry       # scrape one vendor end-to-end into data/hpr.db
hpr scrape all              # scrape every configured vendor
hpr snapshot export         # dump current DB state to data/snapshot.json (for the frontend)
```

## Layout

```
hpr_finder/
  catalog.py       ThrustCurve loader; AeroTech motor reference
  db.py            SQLite schema + helpers
  http.py          Polite httpx client (rate-limited, identifying UA)
  models.py        Dataclasses: Motor, Listing, ScrapeRun, StockStatus
  normalize.py     Vendor product title -> canonical motor ID
  status.py        StockStatus enum + per-vendor signal -> status mapping
  cli.py           Typer commands
  scrapers/
    base.py        Scraper protocol + shared helpers
    csrocketry.py  Chris' Rocket Supplies scraper
```
