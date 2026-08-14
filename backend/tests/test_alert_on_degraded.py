"""Behaviour tests for .github/scripts/alert_on_degraded.sh — the hourly scrape's
issue-alerting glue, and (in the hands-off operating model) the ONLY thing that
notifies a human when a vendor breaks.

The health *report* is generated + tested in Python (test_snapshot_export). These
tests cover the shell script's decision + GitHub-issue lifecycle: open an issue on
a sustained problem, close it on recovery, and stay quiet otherwise. ``gh`` is
stubbed with a fake on PATH that records its arguments, so nothing touches GitHub.

Requires ``jq`` + ``bash`` (present on the CI ubuntu runner).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "alert_on_degraded.sh"

# Fake `gh`: log every invocation, and for `gh issue list` emit the configured
# existing-issue number (or nothing) so the script's "is an issue already open?"
# check can be driven from the test.
_FAKE_GH = """#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
if [[ "$1" == "issue" && "$2" == "list" ]]; then
  [[ -n "${GH_EXISTING:-}" ]] && echo "$GH_EXISTING"
fi
exit 0
"""

pytestmark = pytest.mark.skipif(
    not (shutil.which("jq") and shutil.which("bash")),
    reason="alert script needs jq + bash",
)


def _base_report(**overrides) -> dict:
    """A healthy report; override fields to drive each scenario."""
    report = {
        "generated_at": "2026-06-11T12:00:00+00:00",
        "degraded": False,
        "max_stale_hours": 0.0,
        "carried": [],
        "failed": [],
        "decision": {"csrocketry": "healthy"},
        "stale_hours": {"csrocketry": 0.0},
        "anomaly_sustained": False,
        "anomalies": [],
        "run_durations": {"csrocketry": 5.0},
        "no_finished_run": [],
        "zero_coverage": [],
        "scrape_errors": {},
    }
    report.update(overrides)
    return report


def _run(tmp_path, report, *, existing="", threshold="6", write_report=True):
    """Run the alert script against ``report`` with a stubbed gh. Returns
    (gh_calls, run_summary_text)."""
    report_path = tmp_path / "status.json"
    if write_report:
        report_path.write_text(json.dumps(report))

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    gh = bin_dir / "gh"
    gh.write_text(_FAKE_GH)
    gh.chmod(0o755)

    gh_log = tmp_path / "gh.log"
    gh_log.write_text("")
    summary = tmp_path / "summary.md"

    env = {
        **os.environ,
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "GH_LOG": str(gh_log),
        "GH_EXISTING": existing,
        "GITHUB_STEP_SUMMARY": str(summary),
    }
    subprocess.run(["bash", str(SCRIPT), str(report_path), threshold], env=env, check=True)
    calls = [line for line in gh_log.read_text().splitlines() if line.strip()]
    return calls, (summary.read_text() if summary.exists() else "")


def _did(calls, *needles) -> bool:
    """True if some gh invocation contains all of ``needles``."""
    return any(all(n in c for n in needles) for c in calls)


def test_healthy_run_opens_no_issue(tmp_path):
    calls, summary = _run(tmp_path, _base_report())
    assert not _did(calls, "issue", "create")
    assert not _did(calls, "issue", "close")
    assert "✅" in summary


def test_sustained_staleness_opens_a_tracking_issue(tmp_path):
    calls, summary = _run(tmp_path, _base_report(degraded=True, max_stale_hours=8.0, carried=["amw"]))
    assert _did(calls, "issue", "create")
    assert "🚨" in summary


def test_sustained_anomaly_opens_a_tracking_issue(tmp_path):
    report = _base_report(
        anomaly_sustained=True,
        anomalies=[{"vendor": "csrocketry", "streak": 3, "reasons": ["listings 1 vs ~600 baseline"]}],
    )
    calls, _ = _run(tmp_path, report)
    assert _did(calls, "issue", "create")


def test_within_threshold_degraded_does_not_escalate(tmp_path):
    # Degraded (carry-forward absorbing it) but stale under the 6h threshold and
    # no sustained anomaly → no issue, just a ⚠️ summary.
    calls, summary = _run(tmp_path, _base_report(degraded=True, max_stale_hours=3.0, carried=["amw"]))
    assert not _did(calls, "issue", "create")
    assert not _did(calls, "issue", "close")
    assert "⚠️" in summary


def test_recovery_closes_the_open_issue(tmp_path):
    calls, _ = _run(tmp_path, _base_report(), existing="42")
    assert _did(calls, "issue", "comment", "42")
    assert _did(calls, "issue", "close", "42")
    assert not _did(calls, "issue", "create")


def test_still_sustained_with_open_issue_stays_quiet(tmp_path):
    # An issue is already open and the problem persists → no duplicate, no close.
    calls, _ = _run(tmp_path, _base_report(degraded=True, max_stale_hours=8.0), existing="42")
    assert not _did(calls, "issue", "create")
    assert not _did(calls, "issue", "close")


def test_missing_report_is_a_noop(tmp_path):
    # Export failed before writing the report → script must not crash or touch gh.
    calls, summary = _run(tmp_path, _base_report(), write_report=False)
    assert calls == []
    assert "No health report" in summary


# --- chronic degradation -----------------------------------------------------


def _chronic_report(**overrides):
    return _base_report(
        degraded=True,
        carried=["sirius"],
        max_stale_hours=2.0,  # well under the 6h threshold — staleness won't fire
        decision={"sirius": "carried"},
        chronic_any=True,
        chronic=[
            {
                "vendor": "sirius",
                "carried": 5,
                "window": 24,
                "reason": "degraded in 5 of the last 24 runs (opens at 5, clears at 2)",
            }
        ],
        carry_rates={"sirius": {"carried": 5, "window": 24}},
        **overrides,
    )


def test_chronic_degradation_opens_a_tracking_issue(tmp_path):
    # The gap this closes: short outages that recover before the staleness
    # threshold, on a vendor that's carried (so the anomaly path skips it).
    calls, summary = _run(tmp_path, _chronic_report())
    assert _did(calls, "issue", "create")
    assert "🚨" in summary
    assert "chronically degraded" in summary or "Chronically degraded" in summary


def test_chronic_issue_names_the_vendor_and_its_rate(tmp_path):
    calls, summary = _run(tmp_path, _chronic_report())
    body = "\n".join(calls)
    assert "sirius" in body
    assert "5 of the last 24 runs" in body
    assert "5/24 runs degraded" in summary


def test_chronic_recovery_closes_the_issue(tmp_path):
    report = _base_report(chronic_any=False, chronic=[], carry_rates={"sirius": {"carried": 1, "window": 24}})
    calls, _ = _run(tmp_path, report, existing="42")
    assert _did(calls, "issue", "close", "42")


def test_carry_rates_are_reported_without_escalating(tmp_path):
    # Below the chronic threshold: visible in the summary, but no issue.
    report = _base_report(carry_rates={"amw": {"carried": 2, "window": 24}})
    calls, summary = _run(tmp_path, report)
    assert not _did(calls, "issue", "create")
    assert "2/24 runs degraded" in summary


def test_report_without_chronic_fields_still_works(tmp_path):
    # An older report (pre-chronic) must not crash the alerter or escalate.
    report = _base_report()
    report.pop("chronic_any", None)
    calls, summary = _run(tmp_path, report)
    assert not _did(calls, "issue", "create")
    assert "✅" in summary
