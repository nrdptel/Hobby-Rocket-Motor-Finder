#!/usr/bin/env bash
# Surface scrape health with minimal noise, from the report written by
# `hpr snapshot export --report-json`.
#
# Philosophy: carry-forward already handles transient vendor blips gracefully,
# so we do NOT alert on every degraded run. We escalate to a tracking issue only
# on a SUSTAINED problem, of which there are now two kinds:
#   1. Staleness — a vendor whose published data has gone stale beyond a
#      threshold (carried-forward data keeps its original seen_at, so staleness
#      grows each hour the outage persists).
#   2. Below-baseline anomaly — a vendor that's above floor + freshly scraped but
#      well below its OWN normal listing/in-stock counts for enough consecutive
#      runs (partial degradation, or an in-stock collapse that staleness misses
#      because the data is fresh). Computed in hpr health and reported as
#      .anomaly_sustained.
# Total failures exit the workflow non-zero and are covered by GitHub's native
# failure email, so they're not the issue's job.
#
# Every run:   write a one-line health note to the Actions run summary.
# Sustained:   open ONE tracking issue (keyed on a fixed title; no duplicates).
# While open:  stay silent — the open issue is the signal, no hourly comments.
# Recovered:   comment "recovered" and close the issue.
#
# Requires: gh (authenticated via GH_TOKEN), jq. Needs `issues: write`.
set -euo pipefail

REPORT="${1:-data/scrape-status.json}"
THRESHOLD_HOURS="${2:-6}"
TITLE="🚨 Scrape health: a vendor needs attention"

summary() { [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo -e "$1" >> "$GITHUB_STEP_SUMMARY" || true; }

if [[ ! -f "$REPORT" ]]; then
  echo "no report at $REPORT — export likely failed before writing it; skipping alert"
  summary "### Scrape health\n⚠️ No health report produced — the export step likely failed earlier. See logs."
  exit 0
fi

degraded=$(jq -r '.degraded' "$REPORT")
max_stale=$(jq -r '.max_stale_hours // 0' "$REPORT")
carried=$(jq -r '.carried | join(", ") | if . == "" then "none" else . end' "$REPORT")
failed=$(jq -r '.failed  | join(", ") | if . == "" then "none" else . end' "$REPORT")
generated=$(jq -r '.generated_at' "$REPORT")
detail=$(jq -r '
  (.stale_hours // {}) as $s
  | .decision | to_entries | sort_by(.key)
  | map("- **\(.key)**: \(.value) (stale \($s[.key] // "—")h)")
  | join("\n")
' "$REPORT")

# Sustained-staleness gate: is the freshest published data older than the threshold?
sustained=$(jq -r --argjson t "$THRESHOLD_HOURS" '(.max_stale_hours // 0) >= $t' "$REPORT")

# Sustained below-baseline anomaly (older reports lack the field → default false).
anomaly_sustained=$(jq -r '.anomaly_sustained // false' "$REPORT")
anomalies=$(jq -r '
  (.anomalies // [])
  | if length == 0 then "none"
    else map("- **\(.vendor)** (streak \(.streak)): \(.reasons | join("; "))") | join("\n")
    end
' "$REPORT")
has_anomaly=$(jq -r '((.anomalies // []) | length) > 0' "$REPORT")

# Per-vendor scrape duration — visibility only (older reports lack the fields).
max_run=$(jq -r '.max_run_seconds // 0' "$REPORT")
durations=$(jq -r '
  (.run_durations // {}) | to_entries | sort_by(-.value)
  | if length == 0 then "—"
    else map("- **\(.key)**: \(.value)s") | join("\n")
    end
' "$REPORT")
no_finished=$(jq -r '.no_finished_run // [] | join(", ") | if . == "" then "none" else . end' "$REPORT")

# Per-vendor last scrape error, categorized (failed runs only; old reports lack it).
scrape_errors=$(jq -r '
  (.scrape_errors // {}) | to_entries | sort_by(.key)
  | if length == 0 then "none"
    else map("- **\(.key)** [\(.value.category)]: \(.value.detail)") | join("\n")
    end
' "$REPORT")

# Either sustained signal escalates to the single tracking issue.
escalate=false
[[ "$sustained" == "true" || "$anomaly_sustained" == "true" ]] && escalate=true

# --- always: run summary ---------------------------------------------------
if [[ "$escalate" == "true" ]]; then
  icon="🚨"
  reasons=()
  [[ "$sustained" == "true" ]] && reasons+=("data stale ${max_stale}h (≥ ${THRESHOLD_HOURS}h)")
  [[ "$anomaly_sustained" == "true" ]] && reasons+=("vendor below baseline")
  head="SUSTAINED: $(IFS=';'; echo "${reasons[*]}")"
elif [[ "$degraded" == "true" ]]; then
  icon="⚠️"; head="degraded but within threshold (carry-forward absorbing it)"
elif [[ "$has_anomaly" == "true" ]]; then
  icon="⚠️"; head="below-baseline anomaly within streak threshold (watching)"
else
  icon="✅"; head="healthy"
fi
summary "### Scrape health — ${icon} ${head}
**Run:** ${generated} · **max stale:** ${max_stale}h · **carried:** ${carried} · **failed:** ${failed}

${detail}

**Below-baseline anomalies:**
${anomalies}

**Scrape duration** (max ${max_run}s · no finished run: ${no_finished}):
${durations}

**Last scrape errors:**
${scrape_errors}"

# --- issue lifecycle: sustained staleness OR a sustained below-baseline anomaly ---
# Tolerate a transient GitHub API hiccup: under `set -e` an un-guarded failure
# here would abort the whole alerter (after the run summary, before opening or
# closing the issue) on the very run an outage needs it. Degrade to "no issue
# action this run" instead of crashing.
existing=$(gh issue list --state open --search "in:title $TITLE" \
  --json number,title \
  --jq "map(select(.title == \"$TITLE\")) | .[0].number // empty" 2>/dev/null || echo "")

body="Automated by the hourly scrape workflow.

A sustained scrape-health problem is being masked by carry-forward / fresh-but-degraded data — not a transient blip.

**Run:** ${generated}
**Staleness:** max ${max_stale}h (threshold ${THRESHOLD_HOURS}h) — sustained: ${sustained}
**Below-baseline anomaly sustained:** ${anomaly_sustained}
**Carried forward (serving last-good data):** ${carried}
**Failed (no data at all):** ${failed}

Per-vendor decision:
${detail}

Below-baseline anomalies (vendor above floor + fresh, but well under its own normal counts):
${anomalies}

Last scrape errors (categorized — why the latest run failed):
${scrape_errors}

Vendors with no finished scrape run this cycle (likely a hang): ${no_finished}

This issue auto-closes once the scrape is healthy again. Logs: [Actions](../../actions/workflows/scrape.yml)."

if [[ "$escalate" == "true" ]]; then
  if [[ -n "$existing" ]]; then
    echo "sustained problem; issue #$existing already open — staying quiet"
  else
    echo "sustained problem; opening tracking issue"
    gh issue create --title "$TITLE" --body "$body"
  fi
else
  if [[ -n "$existing" ]]; then
    echo "recovered; closing issue #$existing"
    gh issue comment "$existing" --body "✅ Recovered as of ${generated} — staleness ${max_stale}h (< ${THRESHOLD_HOURS}h) and no sustained below-baseline anomaly. Closing."
    gh issue close "$existing"
  else
    echo "no sustained problem; nothing to do (summary written)"
  fi
fi
