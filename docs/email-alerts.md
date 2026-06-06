# Restock email alerts — setup

Free, serverless "email me when this motor is back in stock." Optional: if the
env vars below aren't set, the 🔔 button hides and the API routes return 503, so
the site works exactly as without it.

## How it works

```
visitor clicks 🔔 → POST /api/alerts/subscribe (Vercel fn)
        → double-opt-in email (Resend) → click confirm → GET /api/alerts/confirm
        → email added to Upstash set  sub:<manufacturer::designation>

hourly scrape (GitHub Actions): export snapshot
        → hpr alerts dispatch  (diff prev vs new snapshot for out→in restocks)
        → POST /api/alerts/dispatch  (Bearer ALERTS_DISPATCH_SECRET)
        → for each restocked motor: look up subscribers in Upstash,
          email each via Resend (per-motor 6h cooldown to avoid dupes)

self-serve manage (no restock needed): /alerts page → enter email
        → POST /api/alerts/manage-request → magic link emailed (1h, signed "m" token)
        → GET /api/alerts/manage?token=… → token-gated page lists this email's
          subscriptions with per-motor + "unsubscribe from all" links
```

A reverse index `umotors:<email>` (set of motorKeys) is kept in sync alongside
the `sub:<motorKey>` sets on confirm/unsubscribe so the manage page can list a
user's subscriptions. To prevent email enumeration, `/api/alerts/manage-request`
always returns the same response and only emails the link if the address
actually has alerts — the list itself is shown only after the magic link proves
inbox ownership, so no one can view or change anyone else's subscriptions.

All subscriber/email logic is TypeScript on Vercel (`frontend/lib/alerts`,
`frontend/app/api/alerts/*`); the Python side only computes restocks
(`backend/hpr_finder/alerts.py`) and POSTs them. Confirm/unsubscribe links are
stateless HMAC-signed tokens (no DB rows for pending/unsub).

## One-time setup

1. **Resend** (email sending — free 3k/mo, 100/day): create an account, **verify
   your sending domain** (add the SPF/DKIM DNS records it gives you), and create
   an API key. Pick a from address on that domain.
2. **Upstash** (subscriber store — free tier): create a Redis database, copy its
   **REST URL** and **REST token** (not the redis:// URL).
3. **Generate two random secrets:** `openssl rand -hex 32` for each of
   `ALERTS_SECRET` (token signing) and `ALERTS_DISPATCH_SECRET` (CI→dispatch auth).
4. **Vercel** → Project → Settings → Environment Variables (Production), then redeploy:
   | Var | Value |
   |---|---|
   | `RESEND_API_KEY` | from Resend |
   | `ALERTS_FROM` | e.g. `HPR Motor Finder <alerts@yourdomain>` |
   | `UPSTASH_REDIS_REST_URL` | from Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | from Upstash |
   | `ALERTS_SECRET` | random hex |
   | `ALERTS_DISPATCH_SECRET` | random hex |
   | `NEXT_PUBLIC_ALERTS_ENABLED` | `1` (shows the 🔔 button) |
   | `NEXT_PUBLIC_SITE_URL` | `https://motor.fusionspace.co` |
5. **GitHub** → repo → Settings → Secrets and variables → Actions → add:
   - `ALERTS_DISPATCH_URL` = `https://motor.fusionspace.co/api/alerts/dispatch`
   - `ALERTS_DISPATCH_SECRET` = the **same** value as in Vercel
   The hourly `scrape.yml` reads these; without them the dispatch step is a no-op.

## Verify

- On the site, click 🔔 on a motor, enter your email → you should get a confirm
  email → click it → "You're subscribed".
- Dry-run the restock diff locally without sending:
  `hpr alerts dispatch --prev <old-snapshot.json> --current data/snapshot.json --dry-run`

## Notes

- **Cost:** restocks are rare and the audience is modest, so usage stays well
  within all free tiers.
- **Privacy:** the only stored PII is subscriber emails (in Upstash). Every alert
  email has a one-click unsubscribe (RFC 8058 + link), and the `/alerts` page lets
  anyone view/cancel all their alerts via an emailed magic link — with no way to
  probe whether a given address is subscribed.
- **Disable:** remove `NEXT_PUBLIC_ALERTS_ENABLED` (hides the button) and/or the
  other env vars (routes 503). The scrape's dispatch step no-ops without its
  secrets.
