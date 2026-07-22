# Scrape relay (Cloudflare Worker)

A tiny, authenticated fetch-relay that lets the hourly scraper reach vendors that
block the GitHub Actions data-center IP (and even a residential-proxy pool) but
still serve `200` to a clean-reputation IP. Cloudflare's egress is such an IP, and
Workers are free (100k requests/day — we use a few hundred).

The scraper (`backend/hpr_finder/http.py`) uses this as its **first** fail-over tier:
`direct → relay (this) → residential proxy → carry-forward`. It only ever engages
when a vendor `429`/`403`s us, and it forwards our honest `User-Agent` to the origin.

It is **not** an open proxy: every request needs the shared secret **and** the target
host must be on the allow-list in `worker.js` (the project's vendor domains).

## Deploy

You need a (free) Cloudflare account. Pick a strong random secret first, e.g.:

```sh
openssl rand -hex 24        # copy the output — this is your RELAY_SECRET
```

### Option A (recommended) — GitHub Action, reusing the Pages credentials

No local tooling and no new token: the **Deploy scrape-relay Worker** workflow
(`.github/workflows/deploy-relay-worker.yml`) deploys this Worker using the same
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo secrets that already deploy the
site to Pages, and sets the Worker's `RELAY_SECRET` from the `SCRAPER_RELAY_SECRET`
repo secret.

1. Add the repo secret `SCRAPER_RELAY_SECRET` (your value from above).
2. Actions tab → **Deploy scrape-relay Worker** → **Run workflow**.
3. The run log prints the Worker URL (`https://hpr-scrape-relay.<subdomain>.workers.dev`).
   Add it as the repo secret `SCRAPER_RELAY_URL`.

If the run fails on a permissions error, the `CLOUDFLARE_API_TOKEN` is Pages-only —
edit it at `dash.cloudflare.com/profile/api-tokens` to add **Workers Scripts: Edit**,
then re-run.

### Option B — Wrangler (CLI)

```sh
cd workers/scrape-relay
npx wrangler login
npx wrangler deploy                 # prints the Worker URL, e.g. https://hpr-scrape-relay.<you>.workers.dev
npx wrangler secret put RELAY_SECRET   # paste the secret from above
```

### Option B — Dashboard (no CLI)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it `hpr-scrape-relay`, **Deploy**, then **Edit code** and paste the contents
   of `worker.js`. **Save and deploy**.
3. Worker → **Settings** → **Variables and Secrets** → add a **Secret** named
   `RELAY_SECRET` with the value from above. Save.
4. Copy the Worker URL from the Worker's overview page.

## Wire it into the scraper

Add two **GitHub Actions repository secrets** (repo → Settings → Secrets and
variables → Actions):

| Secret | Value |
| --- | --- |
| `SCRAPER_RELAY_URL` | the Worker URL (e.g. `https://hpr-scrape-relay.<you>.workers.dev`) |
| `SCRAPER_RELAY_SECRET` | the same secret you set as the Worker's `RELAY_SECRET` |

That's it — the next hourly scrape picks them up. Leaving either unset just skips the
relay tier (the scraper falls back to direct → proxy, unchanged).

## Test it

```sh
# Blocked host, correct secret → should return the vendor's JSON with 200:
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "X-Relay-Auth: <RELAY_SECRET>" \
  "https://hpr-scrape-relay.<you>.workers.dev/?url=https%3A%2F%2Fwildmanrocketry.com%2Fproducts.json%3Flimit%3D250%26page%3D1"

# Wrong/no secret → 403.  Non-allow-listed host → 403.
```

## Add a vendor host later

Edit the `ALLOWED_HOSTS` set in `worker.js` and redeploy.
