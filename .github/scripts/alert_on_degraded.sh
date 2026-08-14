#!/usr/bin/env bash
# Surface scrape health with minimal noise, from the report written by
# `hpr snapshot export --report-json`.
#
# Philosophy: carry-forward already handles transient vendor blips gracefully,
# so we do NOT alert on every degraded run. We escalate to a tracking issue only
# on a SUSTAINED problem, of which there are now three kinds:
#   1. Staleness — a vendor whose published data has gone stale beyond a
#      threshold (carried-forward data keeps its original seen_at, so staleness
#      grows each hour the outage persists).
#   2. Below-baseline anomaly — a vendor that's above floor + freshly scraped but
#      well below its OWN normal listing/in-stock counts for enough consecutive
#      runs (partial degradation, or an in-stock collapse that staleness misses
#      because the data is fresh). Computed in hpr health and reported as
#      .anomaly_sustained.
#   3. Chronic degradation — a vendor that keeps failing and recovering: never
#      stale long enough to trip (1) and never freshly-scraped when it fails, so
#      invisible to (2). Reported as .chronic_any, latched with hysteresis in
#      hpr health so a vendor near the threshold can't flap the issue hourly.
# Total failures exit the workflow non-zero and are covered by GitHub's native
# failure email, so they're not the issue's job.
#
# Every run:   write a one-line health note to the Actions run summary.
# Sustained:   open ONE tracking issue per KIND (keyed on a fixed title).
# While open:  stay silent — the open issue is the signal, no hourly comments.
# Recovered:   comment "recovered" and close the issue.
#
# Outage (1-2) and chronic (3) get SEPARATE issues on purpose. Chronic degradation
# is by nature long-lived — a vendor failing ~a fifth of its runs sits latched for
# weeks — and "stay silent while open" is scoped to one issue. Sharing an issue
# would mean a chronic vendor pins it open and silences the outage alert for the
# entire time, which is strictly worse than the gap this is meant to close.
#
# Requires: gh (authenticated via GH_TOKEN), jq. Needs `issues: write`.
set -euo pipefail

REPORT="${1:-data/scrape-status.json}"
THRESHOLD_HOURS="${2:-6}"
TITLE="🚨 Scrape health: a vendor needs attention"
CHRONIC_TITLE="⚠️ Scrape health: a vendor is chronically degraded"
# Repo owner (from the workflow's github.repository_owner). When set, the tracking
# issue @mentions and is assigned to them, so the alert notifies reliably even if
# their repo watch is "participating only". Forks get their own owner here.
OWNER="${OWNER:-}"

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

# Chronic degradation (older reports lack the fields → default empty/false).
chronic_any=$(jq -r '.chronic_any // false' "$REPORT")
chronic=$(jq -r '
  (.chronic // [])
  | if length == 0 then "none"
    else map("- **\(.vendor)**: \(.reason)") | join("\n")
    end
' "$REPORT")
# Every vendor's recent carry rate — visible before it crosses the threshold.
rates=$(jq -r '
  (.carry_rates // {}) | to_entries | map(select(.value.carried > 0)) | sort_by(-.value.carried)
  | if length == 0 then "all vendors clean over the tracked window"
    else map("- **\(.key)**: \(.value.carried)/\(.value.window) runs degraded") | join("\n")
    end
' "$REPORT")

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

# Registered vendors that published 0 listings this run (blocked / no-match) —
# visibility only; older reports lack the field.
zero_coverage=$(jq -r '.zero_coverage // [] | join(", ") | if . == "" then "none" else . end' "$REPORT")

# Per-vendor last scrape error, categorized (failed runs only; old reports lack it).
scrape_errors=$(jq -r '
  (.scrape_errors // {}) | to_entries | sort_by(.key)
  | if length == 0 then "none"
    else map("- **\(.key)** [\(.value.category)]: \(.value.detail)") | join("\n")
    end
' "$REPORT")

# Any sustained signal drives the 🚨 run-summary headline. Which ISSUE it opens is
# decided per-kind below.
escalate=false
[[ "$sustained" == "true" || "$anomaly_sustained" == "true" || "$chronic_any" == "true" ]] \
  && escalate=true

# --- always: run summary ---------------------------------------------------
if [[ "$escalate" == "true" ]]; then
  icon="🚨"
  reasons=()
  [[ "$sustained" == "true" ]] && reasons+=("data stale ${max_stale}h (≥ ${THRESHOLD_HOURS}h)")
  [[ "$anomaly_sustained" == "true" ]] && reasons+=("vendor below baseline")
  [[ "$chronic_any" == "true" ]] && reasons+=("vendor chronically degraded")
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

**Chronically degraded:**
${chronic}

**Recent degradation rate:**
${rates}

**Scrape duration** (max ${max_run}s · no finished run: ${no_finished}):
${durations}

**Zero-coverage vendors** (registered, 0 published listings): ${zero_coverage}

**Last scrape errors:**
${scrape_errors}"

# --- issue lifecycle ---------------------------------------------------------
# One auto-closing issue per KIND, keyed on its title. Tolerate a transient GitHub
# API hiccup: under `set -e` an un-guarded failure here would abort the whole
# alerter (after the run summary, before opening or closing) on the very run an
# outage needs it. Degrade to "no issue action this run" instead of crashing.
sync_issue() {
  local title="$1" want_open="$2" body="$3" recovery="$4"
  local existing url num
  existing=$(gh issue list --state open --search "in:title $title" \
    --json number,title \
    --jq "map(select(.title == \"$title\")) | .[0].number // empty" 2>/dev/null || echo "")

  if [[ "$want_open" == "true" ]]; then
    if [[ -n "$existing" ]]; then
      echo "problem persists; issue #$existing already open — staying quiet"
      return
    fi
    echo "opening tracking issue: $title"
    url=$(gh issue create --title "$title" --body "$body")
    echo "opened: $url"
    # Assign the owner on top of the @mention so the notification lands even with
    # a "participating only" watch. Tolerate a non-assignable owner (some fork/org
    # setups) — the body @mention still pings them.
    num="${url##*/}"
    if [[ -n "$OWNER" && -n "$num" ]]; then
      gh issue edit "$num" --add-assignee "$OWNER" >/dev/null 2>&1 \
        || echo "note: couldn't assign @$OWNER (not assignable?) — relying on the @mention"
    fi
  else
    if [[ -n "$existing" ]]; then
      echo "recovered; closing issue #$existing"
      gh issue comment "$existing" --body "$recovery"
      gh issue close "$existing"
    else
      echo "nothing to do for: $title (summary written)"
    fi
  fi
}

# 1-2: a sustained OUTAGE — data stale past the threshold, or a vendor sustained
# below its own baseline.
outage_body="${OWNER:+@$OWNER — }Automated by the hourly scrape workflow.

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

outage=false
[[ "$sustained" == "true" || "$anomaly_sustained" == "true" ]] && outage=true
sync_issue "$TITLE" "$outage" "$outage_body" \
  "✅ Recovered as of ${generated} — staleness ${max_stale}h (< ${THRESHOLD_HOURS}h) and no sustained below-baseline anomaly. Closing."

# 3: CHRONIC degradation — a vendor that keeps failing and recovering. Tracked
# separately so it can stay open for as long as it's true without silencing the
# outage issue above.
chronic_body="${OWNER:+@$OWNER — }Automated by the hourly scrape workflow.

A vendor is failing and recovering repeatedly. Each outage is short enough that the published data never goes stale long enough to escalate, and the vendor is carried on exactly those runs — so the staleness and below-baseline checks both miss it.

**Run:** ${generated}

Chronically degraded:
${chronic}

Recent degradation rate, all vendors:
${rates}

Last scrape errors (categorized — why the latest run failed):
${scrape_errors}

Expect this to stay open while the pattern holds; it auto-closes once the rate drops back. Logs: [Actions](../../actions/workflows/scrape.yml)."

sync_issue "$CHRONIC_TITLE" "$chronic_any" "$chronic_body" \
  "✅ Recovered as of ${generated} — no vendor is chronically degraded any more. Closing."
