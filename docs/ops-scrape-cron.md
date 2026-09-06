# Scrape scheduling

The hourly scrape is triggered two ways:

| Trigger | Cadence | Role |
|---|---|---|
| **External cron (cron-job.org)** → `workflow_dispatch` | every hour, `0 * * * *` | **Primary** — reliable |
| **GitHub `schedule`** (in `scrape.yml`) | every 6 hours, `0 */6 * * *` | **Fallback** — if the external cron is down |

## Why

GitHub Actions' built-in `schedule` cron is best-effort: under platform load it
silently delays or drops scheduled runs. In practice the "hourly" cron was
firing closer to every ~1.5 hours with occasional 2h+ gaps. An external cron
calling the `workflow_dispatch` API fires reliably on the hour.

The GitHub `schedule` is kept as a sparse (6-hourly) fallback so a cron-job.org
outage can't leave the data badly stale — it just won't refresh hourly until the
external trigger is back. (A sustained-stale run also opens a tracking issue; see
the alerting step in `scrape.yml`.)

## The fallback only runs when it's needed

A `schedule` firing is delivered late enough that it usually queues *behind* the
hourly dispatch and starts minutes after it finishes. Left alone it then rescrapes
twelve small vendor sites that were just scraped, spends ~7 minutes of Actions
time, and races the hourly run for the same wholly-regenerated data files — which
used to end in a rebase conflict that failed the run and dropped its data (the
`Commit changes` step now rebuilds its commit on the new tip instead of rebasing).

So the workflow's `decide` job skips a `schedule` run while `data/snapshot.json`
is under 90 minutes old: fresh data means the external cron is doing its job.
Every other trigger (manual or cron-job.org dispatch) always runs, and the check
fails **open** — if the snapshot's age can't be read, the fallback scrapes.

## External cron configuration (cron-job.org)

- **URL:** `https://api.github.com/repos/nrdptel/Hobby-Rocket-Motor-Finder/actions/workflows/scrape.yml/dispatches`
- **Method:** `POST`
- **Body:** `{"ref":"main"}`
- **Schedule:** `0 * * * *`
- **Headers:**
  - `Authorization: Bearer <FINE_GRAINED_PAT>`
  - `Accept: application/vnd.github+json`
  - `X-GitHub-Api-Version: 2022-11-28`
  - `Content-Type: application/json`
- Success response is `204 No Content`.

### The token

A GitHub **fine-grained personal access token** scoped to **only this repo** with
**Actions: Read and write** (nothing else). That permission is the minimum the
`workflow_dispatch` API requires; it cannot touch code, secrets, or other repos.
Rotate it on the token's expiry. If it leaks, the only capability is
triggering/cancelling this repo's workflows — revoke it at
<https://github.com/settings/tokens?type=beta>.

## Manual trigger

```sh
gh workflow run scrape.yml                 # via gh CLI
# or the raw API the external cron uses:
gh api -X POST /repos/nrdptel/Hobby-Rocket-Motor-Finder/actions/workflows/scrape.yml/dispatches -f ref=main
```
