# Hobby Rocket Motor Finder

A web aggregator for U.S. high-power rocketry (HPR) motor availability across multiple vendors.

The U.S. hobby motor shortage makes finding a specific impulse/diameter motor difficult — flyers often have to check each vendor manually. This project scrapes a curated set of vendors on a schedule, normalizes their listings against a canonical motor catalog ([ThrustCurve.org](https://www.thrustcurve.org)), and presents a single searchable view of stock status by motor.

## Status

MVP in progress. Targeting AeroTech motors only, across 5 vendors:

| Vendor | State | Difficulty |
|---|---|---|
| [Chris' Rocket Supplies](https://www.csrocketry.com) | GA | Easy (Schema.org JSON-LD + stock count) |
| [BuyRocketMotors](https://www.buyrocketmotors.com) | TX | Easy (Shopify + Schema.org JSON-LD) |
| [Wildman Rocketry](https://wildmanrocketry.com) | IL | Easy (Shopify + inline product JSON) |
| [Animal Motor Works](https://cart.amwprox.com) | AZ | Medium (VirtueMart category listings) |
| [Sirius Rocketry](https://www.siriusrocketry.biz) | WI | Hard (Zen Cart, partly JS-rendered) |

## Layout

- `backend/` — Python scraper + SQLite catalog + CLI.
- `frontend/` — Next.js UI (App Router, TypeScript, Tailwind).
- `data/` — gitignored runtime artifacts (SQLite DB, snapshot JSON).
- `HPR_Vendor_Report.md` — source-of-truth vendor directory used to seed the project.

## Scraping policy

Scrape respectfully without prior vendor permission:

- Honor `robots.txt`. Vendors that disallow generic crawlers (e.g. Apogee) are not scraped.
- Identify the project in `User-Agent`.
- Rate limit to ~1 request per 30 seconds per vendor.
- Honor `Retry-After`.
- If a vendor sends a takedown or sets a tighter limit, comply immediately. No evasion (rotating UAs, proxies, captcha solvers).
