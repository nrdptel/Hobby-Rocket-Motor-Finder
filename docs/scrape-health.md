# Scrape health monitoring

With ~12 fragile, often-old vendor sites, a scraper can break in several ways.
Health monitoring exists so a silent break doesn't just make the aggregator look
emptier with nobody noticing. There are four layers, from loudest to quietest.

## 0. Soft blocks → a real error, not a zero-listing "success"

The quietest failure of all doesn't reach the layers below in a usable form. Some
hosts answer a blocked run with **HTTP 200** and a body that isn't the page we
asked for — a WAF interstitial, an empty shell. Nothing in the client sees a
problem (a 200 is a 200), the parser finds no products, and the vendor stores
**zero** listings with `ok=1` and no error. Carry-forward papers over it, so the
only symptom is a vendor that degrades and recovers for no visible reason, with
`scrape_errors` reading `none` — which is what a chronic-degradation issue with
nothing to act on looks like (that's what AMW, Moto-Joe and Sirius were doing).

Two halves fix it:

* **Detect and route around it.** `PoliteAsyncClient.get` takes an optional
  `content_ok` predicate for callers that know what a good response must contain
  (Sirius/Moto-Joe: page 1 of a listing always has products; AMW: the VirtueMart
  `browse-view` container, since a few of its categories legitimately hold no
  motors). A 2xx whose body fails the check is retried and escalated to the free
  Cloudflare relay — the same egress fail-over that carries eRockets past its
  outright 403 — and the rejected body's first 200 characters go to the run log,
  because nobody has yet seen what one of these walls actually says. It stops
  short of the **metered** proxy on purpose: a status code is the origin
  declaring the block, a content check is us inferring it, and an inference
  doesn't get to spend money (a check that goes stale after a site redesign would
  otherwise spend it on every request).
* **Never report it as success.** A *full* scrape that produces zero listings
  raises `EmptyScrapeError`, recorded against the run with the `empty-scrape`
  category so the health report names the vendor. This lives in
  `cli._async_scrape_run`, not in each scraper, so it covers every vendor —
  including ones added later — and every route to nothing: discovery walking into
  a wall, *or* discovery succeeding and every product page behind it being
  blocked. `--limit`/`--url` runs are exempt (those legitimately return nothing).
  Carry-forward is unaffected — the published data is still intact.

## 1. Near-total failure → carry-forward + floor

`hpr snapshot export --floor 200` compares each vendor's fresh listing count to a
floor (global 200, with per-vendor overrides in `cli._VENDOR_FLOORS` for small
catalogs). A vendor below its floor is **carried** (its last-good listings are
reused from the previous snapshot) or, with no prior data, **failed** (kept but
flagged).

Every per-vendor override matters. A vendor whose *healthy* catalog sits below its
floor is carried on **every** run, which quietly removes it from the baseline and
from layer 3 entirely — it ends up with no failure detection at all. A test in
`test_snapshot_carry_forward.py` fails if any vendor's healthy count is under its
floor, checked against the floor the workflow actually passes. A snapshot with *no* listings at all refuses to publish (exit non-zero
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

Layers 1–2 miss three cases where a vendor looks "healthy" (above floor) and fresh
(low stale-hours):

- **Partial degradation** — normally ~600 listings, now 300. Above floor, but
  half the catalog silently vanished.
- **In-stock collapse** — a parsing regression returns the normal listing *count*
  but flips (almost) everything to out-of-stock. Fresh + above floor, so nothing
  in layers 1–2 fires — yet the site shows that vendor as sold out.
- **Match-rate erosion** — a normalizer regression leaves a chunk of a vendor's
  catalog **unmatched** (a new product-naming variant the regex no longer maps to
  a ThrustCurve motor). Those listings move into the snapshot's separate
  `unmatched[]` bucket, so the matched count can dip without crossing the 50%
  floor while the vendor's motors silently drop out of the user-facing list. The
  unmatched count for that vendor spikes — that's the signal we watch.

`hpr_finder/health.py` tracks a slow **EWMA baseline** of each vendor's fresh
listing count, in-stock count, **and unmatched count** in `data/health-baseline.json`
(committed each run). A run is **anomalous** when listings fall below 50% of
baseline, in-stock below ~⅓ of baseline (for vendors that normally hold ≥5 in
stock), or unmatched spikes above 2× baseline (only for vendors whose unmatched
baseline is ≥8, and only when the absolute jump is ≥15, so a tiny vendor's noise
can't cry wolf). The baseline only learns from healthy, non-anomalous runs, so a
gradual break can't drag it down to match itself (no boiling-frog). A per-vendor
**consecutive-anomaly streak** (default 3 runs) gates escalation, so one slow run
doesn't cry wolf.

The unmatched metric is **backward-compatible** with existing baselines: a vendor
with no recorded `unmatched` value is never flagged until the metric seeds on its
next healthy run (independent of the count/stock sample counter), so the worst a
real erosion costs after a deploy is one seed run plus the 3-run streak before it
escalates.

Anomalies appear in `scrape-status.json` (`.anomalies`, `.anomaly_sustained`, with
per-vendor fresh unmatched counts under `.fresh_unmatched`), are shown in the run
summary immediately, and a *sustained* anomaly escalates to the same single
tracking issue as staleness. Tunables live in `health.DEFAULTS`.

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

## 4. Chronic degradation → tracking issue (the flapping failures)

Layers 1–3 all assume a failure is either brief (carry-forward absorbs it) or
continuous (staleness grows until it escalates). A vendor that fails *repeatedly
but briefly* falls between them: each outage recovers well inside the 6h staleness
threshold, and because the vendor is **carried** on exactly those runs, layer 3
skips it — anomaly detection only judges healthy vendors. The result is a vendor
serving hours-old data on a large share of runs while every signal reads normal.
That is the ordinary shape of a vendor intermittently blocking the CI egress IP.

`health.update_carry_window` is the one piece of health state that records
non-healthy runs: a rolling window of the last `carry_window` (24) outcomes per
vendor, `1` for carried/failed and `0` for healthy, kept in the same
`data/health-baseline.json`. A vendor is flagged **chronic** once `chronic_open`
(5) of that window are degraded, and stays flagged until it falls to
`chronic_close` (2). The gap between the two is deliberate hysteresis: a vendor
hovering at the threshold would otherwise open and close the tracking issue hour
after hour.

Reported as `.chronic` / `.chronic_any`, plus `.carry_rates` for **every** vendor
every run — so a vendor trending toward the threshold is visible in the run
summary before it crosses it. Registered vendors that published nothing at all are
recorded as degraded too: a vendor blocked to zero with no prior data never reaches
`carry_forward`'s decision map, and that is the failure most worth catching.

This escalates to its **own** tracking issue, separate from layers 2–3. Chronic
degradation is long-lived by nature — a vendor failing ~a fifth of its runs stays
latched for weeks — and the alerter is deliberately silent while an issue is open.
Sharing one issue would let a chronic vendor pin it open and suppress every outage
alert for the whole time, which is worse than the gap this closes.

## Where each signal shows up

| Signal | Surfaced |
|---|---|
| Every run | Actions run summary (✅/⚠️/🚨 + per-vendor detail + scrape durations) |
| Total scrape failure | Workflow fails → GitHub native email |
| Sustained staleness | One auto-closing GitHub issue |
| Sustained below-baseline anomaly | Same GitHub issue |
| Chronic degradation (flapping vendor) | A second, independent GitHub issue |
| Per-vendor recent degradation rate | Run summary every run (`carry_rates`) |
| Slow scrape / hung vendor | Run summary only (duration + no-finished-run list) |

The baseline warms up over the first several runs (needs ≥5 healthy samples per
vendor before it will flag that vendor), so anomaly detection becomes active a few
hours after first deploy. The chronic window needs `chronic_min_window` (12) runs
of history before it will change its verdict, so it becomes active about half a
day after first deploy.
