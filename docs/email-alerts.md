# Restock email alerts — setup

Free, serverless "email me when this motor is back in stock." Optional: if the
env vars below aren't set, the 🔔 button hides and the API routes return 503, so
the site works exactly as without it.

## How it works

```
visitor clicks 🔔 → POST /api/alerts/subscribe (Vercel fn)
        → double-opt-in email (Resend) → click confirm → GET /api/alerts/confirm
        → email added to Upstash set  sub:<manufacturer::designation>

rocket-fit subscribe: My Rockets 🔔 → POST /api/alerts/subscribe-rocket
        → double-opt-in (signed "rc" token carrying the rocket's fit spec)
        → confirm → SADD rocketsubs + urockets:<email>  (member = rocket-sub JSON)
   "email me when ANYTHING that fits <rocket> (diameter + cert + impulse band)
    comes back in stock" — one subscription covers every compatible motor.

hourly scrape (GitHub Actions): export snapshot
        → hpr alerts dispatch  (diff prev vs new snapshot for out→in restocks,
          carrying each restocked motor's diameter/impulse_class/total_impulse)
        → POST /api/alerts/dispatch  (Bearer ALERTS_DISPATCH_SECRET)
        → per-motor: look up sub:<motorKey> subscribers, email each
        → rocket-fit: for each rocketsubs member, find restocked motors that fit
          it and send one digest email (per-(rocket,motor) 6h cooldown)
        → all sends via Amazon SES

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

1. **Amazon SES** (email sending — ~$0.10 per 1,000 emails): in the SES console
   (pick a region, e.g. `us-east-1`), **verify your sending domain** (Easy DKIM →
   add the 3 CNAME records it gives you to DNS) and **request production access**
   (new accounts start in a sandbox that can only send to verified addresses;
   approval takes ~24h). Create an IAM user with `ses:SendEmail` (e.g. the
   `AmazonSESFullAccess` policy) and generate an **access key id + secret**. Pick a
   from address on the verified domain.
2. **Upstash** (subscriber store — free tier): create a Redis database, copy its
   **REST URL** and **REST token** (not the redis:// URL).
3. **Generate two random secrets:** `openssl rand -hex 32` for each of
   `ALERTS_SECRET` (token signing) and `ALERTS_DISPATCH_SECRET` (CI→dispatch auth).
4. **Vercel** → Project → Settings → Environment Variables (Production), then redeploy:
   | Var | Value |
   |---|---|
   | `SES_REGION` | e.g. `us-east-1` (the SES region you verified in) |
   | `SES_ACCESS_KEY_ID` | from the IAM user |
   | `SES_SECRET_ACCESS_KEY` | from the IAM user |
   | `ALERTS_FROM` | e.g. `HPR Motor Finder <alerts@yourdomain>` (on the verified domain) |
   | `UPSTASH_REDIS_REST_URL` | from Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | from Upstash |
   | `ALERTS_SECRET` | random hex |
   | `ALERTS_DISPATCH_SECRET` | random hex |
   | `NEXT_PUBLIC_ALERTS_ENABLED` | `1` (shows the 🔔 button) |
   | `NEXT_PUBLIC_SITE_URL` | `https://motor.fusionspace.co` |

   > Note: the SES vars use an `SES_` prefix, **not** `AWS_` — Vercel runs functions
   > on Lambda, which reserves the `AWS_` prefix for its own runtime credentials.
5. **GitHub** → repo → Settings → Secrets and variables → Actions → add:
   - `ALERTS_DISPATCH_URL` = `https://motor.fusionspace.co/api/alerts/dispatch`
   - `ALERTS_DISPATCH_SECRET` = the **same** value as in Vercel
   The hourly `scrape.yml` reads these; without them the dispatch step is a no-op.

## Verify

- On the site, click 🔔 on a motor, enter your email → you should get a confirm
  email → click it → "You're subscribed".
- Dry-run the restock diff locally without sending:
  `hpr alerts dispatch --prev <old-snapshot.json> --current data/snapshot.json --dry-run`

## Bounce / complaint handling

A hard bounce or spam complaint should stop us emailing that address again
(protects sender reputation). With SES this is handled **automatically** by the
account-level **suppression list**: SES suppresses addresses that hard-bounce or
complain, with no setup required — so reputation is protected out of the box.

To also scrub bounced/complained addresses from *our own* Upstash subscriber list
(so dispatch stops trying them), subscribe SES bounce/complaint notifications to an
**SNS topic** and point it at an HTTP endpoint that removes the address via the
reverse indexes. This is optional and not yet wired up; the legacy
`/api/alerts/resend-webhook` route is unused and inert (its secret is never set).

## One-time backfill (legacy subscriptions)

Subscriptions made before the manage page existed (PR #50) were written only to
the forward set (`sub:<motorKey>`), not the per-email reverse index, so they
don't show on the manage page. To repair, POST once with the dispatch bearer:

```
curl -X POST https://motor.fusionspace.co/api/alerts/admin/backfill \
  -H "Authorization: Bearer $ALERTS_DISPATCH_SECRET"
```

It scans `sub:*` and re-adds each member to `umotors:<email>` (idempotent; rocket
subs need no backfill). Returns `{keysScanned, backfilled}`.

## Abuse / cost protection

- Rate limits key off the **trusted** Vercel client IP (`x-vercel-forwarded-for` /
  `x-real-ip`), not the spoofable leftmost `x-forwarded-for`.
- Public endpoints fail **closed** (no send) if the rate-limit store is down.
- A global **daily cap** on confirmation-email sends bounds Resend-quota abuse
  even if per-IP limiting is somehow evaded (restock dispatch sends are separate).

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
