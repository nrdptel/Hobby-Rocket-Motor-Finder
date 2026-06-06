# Scrape health monitoring

With ~11 fragile, often-old vendor sites, a scraper can break in several ways.
Health monitoring exists so a silent break doesn't just make the aggregator look
emptier with nobody noticing. There are three layers, from loudest to quietest.

## 1. Near-total failure → carry-forward + floor

`hpr snapshot export --floor 200` compares each vendor's fresh listing count to a
floor (global 200, with per-vendor overrides in `cli._VENDOR_FLOORS` for small
catalogs). A vendor below its floor is **carried** (its last-good listings are
reused from the previous snapshot) or, with no prior data, **failed** (kept but
flagged). A snapshot with *no* listings at all refuses to publish (exit non-zero
→ GitHub's native workflow-failure email). See `snapshot.py:carry_forward`.

## 2. Sustained staleness → tracking issue

Carried data keeps its original `seen_at`, so its age grows each hour an outage
persists. `--report-json data/scrape-status.json` records per-vendor
`stale_hours` + `max_stale_hours`. `.github/scripts/alert_on_degraded.sh` writes
a health note to the Actions run summary **every run**, and opens **one** tracking
GitHub issue when `max_stale_hours ≥ threshold` (default 6h) — a *sustained*
outage, not a transient blip. The issue auto-closes on recovery. Transient
carry-forward stays quiet (that's the safety net working).

## 3. Below-baseline anomaly → tracking issue (the quiet failures)

Layers 1–2 miss two cases where a vendor looks "healthy" (above floor) and fresh
(low stale-hours):

- **Partial degradation** — normally ~600 listings, now 300. Above floor, but
  half the catalog silently vanished.
- **In-stock collapse** — a parsing regression returns the normal listing *count*
  but flips (almost) everything to out-of-stock. Fresh + above floor, so nothing
  in layers 1–2 fires — yet the site shows that vendor as sold out.

`hpr_finder/health.py` tracks a slow **EWMA baseline** of each vendor's fresh
listing count and in-stock count in `data/health-baseline.json` (committed each
run). A run is **anomalous** when listings fall below 50% of baseline, or in-stock
below ~⅓ of baseline (for vendors that normally hold ≥5 in stock). The baseline
only learns from healthy, non-anomalous runs, so a gradual break can't drag it
down to match itself (no boiling-frog). A per-vendor **consecutive-anomaly
streak** (default 3 runs) gates escalation, so one slow run doesn't cry wolf.

Anomalies appear in `scrape-status.json` (`.anomalies`, `.anomaly_sustained`),
are shown in the run summary immediately, and a *sustained* anomaly escalates to
the same single tracking issue as staleness. Tunables live in `health.DEFAULTS`.

## Scrape duration (visibility)

The `scrape_runs` table records each vendor run's `started_at`/`finished_at`, so
`--report-json` also emits per-vendor scrape **duration** (`.run_durations`, in
seconds, plus `.max_run_seconds`) from each vendor's latest *finished* run. A
vendor that was attempted this run but never recorded a finished run — hung, or
crashed before `finish_run` — is absent from `run_durations` and listed under
`.no_finished_run` instead of being given a bogus duration. This is **visibility
only** (rendered in the run summary), not yet an escalation signal: a creeping
duration is a leading indicator that a vendor is getting flaky.

For a vendor whose latest finished run *failed*, the report also carries a
**categorized last error** (`.scrape_errors`, per vendor `{category, detail}`)
so the run summary can say *why* it broke — `timeout`/`connection` (usually
transient) vs `http`/`parse` (usually a real break: IP blocked, site HTML
changed) — without opening the CI logs. Healthy runs record nothing here.

## Where each signal shows up

| Signal | Surfaced |
|---|---|
| Every run | Actions run summary (✅/⚠️/🚨 + per-vendor detail + scrape durations) |
| Total scrape failure | Workflow fails → GitHub native email |
| Sustained staleness | One auto-closing GitHub issue |
| Sustained below-baseline anomaly | Same GitHub issue |
| Slow scrape / hung vendor | Run summary only (duration + no-finished-run list) |

The baseline warms up over the first several runs (needs ≥5 healthy samples per
vendor before it will flag that vendor), so anomaly detection becomes active a few
hours after first deploy.
