#!/usr/bin/env bash
# Surface scrape health with minimal noise, from the report written by
# `hpr snapshot export --report-json`.
#
# Philosophy: carry-forward already handles transient vendor blips gracefully,
# so we do NOT alert on every degraded run. We alert only on a SUSTAINED outage
# — a vendor whose published data has gone stale beyond a threshold (its
# carried-forward data keeps its original seen_at, so staleness grows each hour
# the outage persists). Total failures exit the workflow non-zero and are
# covered by GitHub's native failure email, so they're not the issue's job.
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
TITLE="🚨 Scrape health: a vendor has been stale for hours"

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

# Sustained-outage gate: is the freshest published data older than the threshold?
sustained=$(jq -r --argjson t "$THRESHOLD_HOURS" '(.max_stale_hours // 0) >= $t' "$REPORT")

# --- always: run summary ---------------------------------------------------
if [[ "$sustained" == "true" ]]; then
  icon="🚨"; head="SUSTAINED: data stale ${max_stale}h (threshold ${THRESHOLD_HOURS}h)"
elif [[ "$degraded" == "true" ]]; then
  icon="⚠️"; head="degraded but within threshold (carry-forward absorbing it)"
else
  icon="✅"; head="healthy"
fi
summary "### Scrape health — ${icon} ${head}
**Run:** ${generated} · **max stale:** ${max_stale}h · **carried:** ${carried} · **failed:** ${failed}

${detail}"

# --- issue lifecycle: only for sustained staleness -------------------------
# Tolerate a transient GitHub API hiccup: under `set -e` an un-guarded failure
# here would abort the whole alerter (after the run summary, before opening or
# closing the issue) on the very run an outage needs it. Degrade to "no issue
# action this run" instead of crashing.
existing=$(gh issue list --state open --search "in:title $TITLE" \
  --json number,title \
  --jq "map(select(.title == \"$TITLE\")) | .[0].number // empty" 2>/dev/null || echo "")

body="Automated by the hourly scrape workflow.

A vendor's published data has been stale for **${max_stale}h** (alert threshold ${THRESHOLD_HOURS}h) — carry-forward is masking a sustained outage, not a transient blip.

**Run:** ${generated}
**Carried forward (serving last-good data):** ${carried}
**Failed (no data at all):** ${failed}

Per-vendor decision:
${detail}

This issue auto-closes once data is fresh again. Logs: [Actions](../../actions/workflows/scrape.yml)."

if [[ "$sustained" == "true" ]]; then
  if [[ -n "$existing" ]]; then
    echo "sustained outage; issue #$existing already open — staying quiet"
  else
    echo "sustained outage; opening tracking issue"
    gh issue create --title "$TITLE" --body "$body"
  fi
else
  if [[ -n "$existing" ]]; then
    echo "recovered; closing issue #$existing"
    gh issue comment "$existing" --body "✅ Recovered — freshest data is now ${max_stale}h old (< ${THRESHOLD_HOURS}h) as of ${generated}. Closing."
    gh issue close "$existing"
  else
    echo "not a sustained outage; nothing to do (summary written)"
  fi
fi
