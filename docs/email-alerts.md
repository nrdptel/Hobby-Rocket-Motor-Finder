# Restock email alerts — setup

Free, serverless "email me when this motor is back in stock." Optional: if the
env vars below aren't set, the 🔔 button hides and the API routes return 503, so
the site works exactly as without it.

## How it works

```
visitor clicks 🔔 → POST /api/alerts/subscribe (Pages Function)
        → double-opt-in email (ZeptoMail) → click confirm → GET /api/alerts/confirm
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
        → all sends via ZeptoMail

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

All subscriber/email logic is TypeScript running as Cloudflare Pages Functions
(`frontend/lib/alerts`, `frontend/functions/api/alerts/*`); the Python side only
computes restocks
(`backend/hpr_finder/alerts.py`) and POSTs them. Confirm/unsubscribe links are
stateless HMAC-signed tokens (no DB rows for pending/unsub).

## One-time setup

1. **ZeptoMail** (transactional email sending — Zoho; pay-as-you-go credits, with
   a free allotment to start): in the ZeptoMail console, **add and verify your
   sending domain** (add the SPF + DKIM DNS records it gives you), create a
   **Mail Agent** for this app, and under the agent's **Setup Info / SMTP & API**
   tab copy the **Send Mail token** (a long string that already begins with
   `Zoho-enczapikey `). Pick a from address on the verified domain. New accounts
   are review-gated for transactional use; you can send up to 100/day while review
   is pending.
2. **Upstash** (subscriber store — free tier): create a Redis database, copy its
   **REST URL** and **REST token** (not the redis:// URL).
3. **Generate two random secrets:** `openssl rand -hex 32` for each of
   `ALERTS_SECRET` (token signing) and `ALERTS_DISPATCH_SECRET` (CI→dispatch auth).
4. **Cloudflare** → Pages project → Settings → Environment variables (Production),
   then trigger a deploy (the `NEXT_PUBLIC_*` vars are baked in at build time):
   | Var | Value |
   |---|---|
   | `ZEPTOMAIL_TOKEN` | the agent's **Send Mail token** (the full `Zoho-enczapikey …` value) |
   | `ZEPTOMAIL_HOST` | _(optional)_ API host; defaults to `api.zeptomail.com` (use `api.zeptomail.eu` for an EU account) |
   | `ALERTS_FROM` | e.g. `HPR Motor Finder <alerts@yourdomain>` (on the verified domain) |
   | `UPSTASH_REDIS_REST_URL` | from Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | from Upstash |
   | `ALERTS_SECRET` | random hex |
   | `ALERTS_DISPATCH_SECRET` | random hex |
   | `ZEPTOMAIL_WEBHOOK_SECRET` | _(optional)_ shared key for the bounce webhook — see below |
   | `NEXT_PUBLIC_ALERTS_ENABLED` | `1` (shows the 🔔 button) |
   | `NEXT_PUBLIC_SITE_URL` | `https://motor.fusionspace.co` |

   > Treat `ZEPTOMAIL_TOKEN` as a live credential: it can send mail as your domain.
   > Store it only in the Cloudflare Pages env (never in the repo); rotate it from
   > the agent's token list if it leaks.
5. **GitHub** → repo → Settings → Secrets and variables → Actions → add:
   - `ALERTS_DISPATCH_URL` = `https://motor.fusionspace.co/api/alerts/dispatch`
   - `ALERTS_DISPATCH_SECRET` = the **same** value as in Cloudflare Pages
   The hourly `scrape.yml` reads these; without them the dispatch step is a no-op.

## Verify

- On the site, click 🔔 on a motor, enter your email → you should get a confirm
  email → click it → "You're subscribed".
- Dry-run the restock diff locally without sending:
  `hpr alerts dispatch --prev <old-snapshot.json> --current data/snapshot.json --dry-run`

## Bounce / complaint handling

A hard bounce or spam complaint should stop us emailing that address again
(protects sender reputation). ZeptoMail handles this on **its** side
automatically — it suppresses hard-bounced/complained addresses internally, so
deliverability is protected out of the box with no setup.

To also scrub those addresses from *our own* Upstash subscriber list (so dispatch
stops trying them), wire up the optional bounce webhook:

1. In the ZeptoMail agent, add a **Webhook** pointing at
   `https://motor.fusionspace.co/api/alerts/zepto-webhook`, subscribed to the
   **hard bounce** and **feedback loop (spam complaint)** events, with an
   **authentication key** of your choosing.
2. Set `ZEPTOMAIL_WEBHOOK_SECRET` in Cloudflare Pages to that **same** key and redeploy.

The route verifies ZeptoMail's `producer-signature` header (HMAC-SHA256, replay
window 5 min), then removes the recipient from every subscription via the reverse
indexes. It's inert (503) until the secret is set, so a fork without it is
unaffected. Soft/transient bounces are ignored (the address may recover).

> Heads-up: ZeptoMail documents the `producer-signature` header format but not the
> exact signed-content concatenation. We assume `<ts>.<rawBody>`
> (`frontend/lib/alerts/webhook.ts` → `signedContent()`). Verification fails
> **closed**, so if the first real webhook is rejected, confirm the concatenation
> against the delivery and adjust that one function. No request is ever accepted
> without a valid signature.

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

- Rate limits key off the **trusted** Cloudflare client IP (`cf-connecting-ip` /
  `x-real-ip`), not the spoofable leftmost `x-forwarded-for`.
- Public endpoints fail **closed** (no send) if the rate-limit store is down.
- A global **hourly cap** on confirmation-email sends bounds ZeptoMail-credit
  abuse even if per-IP limiting is somehow evaded (restock dispatch sends are
  separate). If ZeptoMail credits do run out mid-run, `/api/alerts/dispatch` stops
  the batch, logs a greppable `ZeptoMail quota exhausted` line, and returns
  `quotaExhausted: true` (which the scrape surfaces in its CI output).

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
