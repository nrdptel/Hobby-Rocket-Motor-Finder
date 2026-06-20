# Public data API

A free, read-only JSON API of the motor catalog — every AeroTech / Cesaroni /
Loki motor we track, with per-vendor stock and pricing.

**Base URL:** `https://motor.fusionspace.co/api/v1/`

It's served as **static files on a CDN** (Cloudflare Pages), so:

- **No rate limits, no API key, no cost.** Hammer it as hard as you like.
- **CORS-open** (`Access-Control-Allow-Origin: *`) — fetch it straight from a browser.
- **Refreshed about hourly** (it regenerates on each deploy of the site). Read
  `meta.json` for the exact `generated_at` timestamp.
- It's static JSON, so there are **no query parameters** — fetch a file and
  filter client-side (the whole dataset is small).

Generated at build time by `frontend/scripts/gen-api.mjs`; the shape is guarded
by `frontend/lib/publicApi.test.ts`.

## Endpoints

| Endpoint | What it is |
|---|---|
| [`GET /api/v1/meta.json`](https://motor.fusionspace.co/api/v1/meta.json) | Schema version, `generated_at`, counts, manufacturer list, endpoint index. Poll this cheaply to detect updates. |
| [`GET /api/v1/motors.json`](https://motor.fusionspace.co/api/v1/motors.json) | Every matched motor we have a listing for (D-class and up, matching the site). |
| [`GET /api/v1/in-stock.json`](https://motor.fusionspace.co/api/v1/in-stock.json) | Same shape, only motors in stock at ≥1 vendor. |
| [`GET /api/v1/vendors.json`](https://motor.fusionspace.co/api/v1/vendors.json) | The vendors we track, with per-vendor motor + in-stock counts. |
| `GET /api/v1/motors/{manufacturer}/{designation}.json` | A single motor. Slugs mirror the site's `/motor` URL — e.g. [`…/motors/aerotech/H128W.json`](https://motor.fusionspace.co/api/v1/motors/aerotech/H128W.json) (`manufacturer` ∈ `aerotech`/`cesaroni`/`loki`; a `/` in a designation is encoded as `~`). |
| [`GET /api/v1/openapi.json`](https://motor.fusionspace.co/api/v1/openapi.json) | OpenAPI 3.1 spec for everything above (drop it into Swagger/Postman/codegen). |

## Schema

Every payload carries `schema_version` (currently `1`) and `generated_at` (ISO
8601 UTC). Breaking changes ship under a new version path (`/api/v2/…`); the
`v1` shape is stable.

### Motor

```jsonc
{
  "id": 1234,                       // stable numeric id for this motor
  "path": "/api/v1/motors/aerotech/H128W.json",  // this motor's own endpoint
  "manufacturer": "AeroTech",       // "AeroTech" | "Cesaroni Technology" | "Loki Research"
  "designation": "H128W",
  "common_name": "H128",            // designation without the propellant code; may be null
  "impulse_class": "H",             // single letter, A–O
  "diameter_mm": 29,
  "total_impulse_ns": 176.2,        // nullable
  "avg_thrust_n": 128,              // nullable
  "burn_time_s": 1.4,               // nullable
  "propellant": "White Lightning",  // nullable
  "sparky": false,                  // metal-additive (throws sparks)
  "motor_type": "reload",           // "reload" | "SU" (single-use) | "hybrid" | null
  "case_info": "RMS-29/180",        // reload hardware; null for single-use
  "delays": "6,10,14",              // nullable
  "delay_adjustable": true,
  "discontinued": false,            // out of production — old stock only
  "in_stock": true,                 // in stock at ≥1 vendor right now
  "vendor_count": 5,                // DISTINCT vendors carrying it (in or out of stock)
  "in_stock_vendor_count": 3,
  "listing_count": 9,               // total listings — a vendor may list several variants (delays, packs)
  "cheapest_in_stock": {            // pack-aware per-unit cheapest in-stock listing; null if none
    "price_cents": 6000,
    "unit_price_cents": 3000,       // sticker price ÷ pack size
    "currency": "USD",
    "vendor": "Wildman",
    "vendor_slug": "wildman",
    "url": "https://…",
    "pack_size": 2
  },
  "listings": [ /* Listing[] — see below */ ]
}
```

### Listing

```jsonc
{
  "vendor": "Chris' Rocket Supplies",
  "vendor_slug": "csrocketry",
  "url": "https://…",               // product page (where you'd buy it)
  "status": "in_stock",             // "in_stock" | "out_of_stock" | "special_order" | "unknown"
  "price_cents": 3499,              // sticker price; nullable
  "unit_price_cents": 3499,         // per-unit (sticker ÷ pack_size); nullable
  "currency": "USD",
  "pack_size": 1,                   // multipack size (1 = single)
  "stock_count": null,              // units on hand when the vendor exposes it
  "lead_time": null,                // e.g. "16–20 weeks" for backorder vendors
  "last_seen": "2026-06-19T04:00:55Z"
}
```

> Prices are integer **cents**. `status` is `in_stock` whether or not a count is
> known; when a vendor publishes an on-hand count it's in `stock_count`.

### Vendor

```jsonc
{
  "slug": "csrocketry",
  "name": "Chris' Rocket Supplies",
  "motor_count": 488,      // DISTINCT motors this vendor carries
  "in_stock_count": 241    // distinct motors it has in stock
}
```

## Examples

```bash
# Cheapest in-stock H motors right now
curl -s https://motor.fusionspace.co/api/v1/in-stock.json \
  | jq '.motors[] | select(.impulse_class=="H")
        | {designation, from: .cheapest_in_stock.unit_price_cents, vendor: .cheapest_in_stock.vendor}'

# When was the data last refreshed?
curl -s https://motor.fusionspace.co/api/v1/meta.json | jq .generated_at
```

```js
// Browser — CORS is open
const { motors } = await (await fetch("https://motor.fusionspace.co/api/v1/in-stock.json")).json();
const cti54 = motors.filter((m) => m.manufacturer === "Cesaroni Technology" && m.diameter_mm === 54);
```

## Terms

Free to use; attribution to **motor.fusionspace.co** is appreciated. The data is
aggregated from public vendor listings and [ThrustCurve](https://www.thrustcurve.org);
it's provided **as-is, with no warranty** — verify stock and price on the
vendor's own page before relying on it.

Please **use this API rather than scraping the vendors directly** — that's the
whole point of it, and it keeps load off the shops. The catalog is small and
refreshes hourly, so caching a copy and polling `meta.json` for changes is plenty.
