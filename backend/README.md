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
hpr catalog refresh         # download AeroTech, Cesaroni, and Loki motors from ThrustCurve
hpr scrape run csrocketry   # scrape one vendor end-to-end into data/hpr.db
hpr scrape run all          # scrape every configured vendor
hpr snapshot export         # dump current DB state to data/snapshot.json (for the frontend)
```

## Layout

```
hpr_finder/
  catalog.py       ThrustCurve loader; AeroTech / Cesaroni / Loki motor reference
  db.py            SQLite schema + helpers
  http.py          Polite httpx client (rate-limited, identifying UA)
  models.py        Dataclasses: Motor, Listing, ScrapeRun, StockStatus
  normalize.py     Vendor product title -> canonical motor ID
  cli.py           Typer commands
  scrapers/
    base.py              Scraper protocol + shared helpers
    csrocketry.py        Chris' Rocket Supplies (AeroTech, Cesaroni)
    buyrocketmotors.py   BuyRocketMotors (AeroTech)
    wildman.py           Wildman Rocketry (AeroTech, Cesaroni)
    amw.py               Animal Motor Works (AeroTech)
    sirius.py            Sirius Rocketry (AeroTech)
    loki.py              Loki Research (Loki)
    performancehobbies.py  Performance Hobbies (AeroTech, Cesaroni, Loki)
```
