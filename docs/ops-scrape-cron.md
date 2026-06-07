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
