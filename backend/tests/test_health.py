"""Tests for baseline-relative scrape-health anomaly detection."""
from __future__ import annotations

from hpr_finder import health


def _snap(listings):
    # listings: list of (vendor_slug, status)
    return {"motors": [{"listings": [{"vendor_slug": v, "status": s} for v, s in listings]}]}


def test_vendor_stock_counts_totals_and_in_stock():
    snap = _snap([
        ("csrocketry", "in_stock"),
        ("csrocketry", "in_stock_with_count"),
        ("csrocketry", "out_of_stock"),
        ("wildman", "special_order"),
    ])
    counts = health.vendor_stock_counts(snap)
    assert counts["csrocketry"] == {"total": 3, "in_stock": 2}
    assert counts["wildman"] == {"total": 1, "in_stock": 0}


def test_vendor_unmatched_counts():
    snap = {
        "motors": [{"listings": [{"vendor_slug": "csrocketry", "status": "in_stock"}]}],
        "unmatched": [
            {"vendor_slug": "csrocketry"},
            {"vendor_slug": "csrocketry"},
            {"vendor_slug": "wildman"},
            {"vendor_slug": ""},      # empty slug — skipped
            {"raw_title": "no slug at all"},  # missing slug — skipped
        ],
    }
    counts = health.vendor_unmatched_counts(snap)
    assert counts == {"csrocketry": 2, "wildman": 1}


def test_no_anomaly_when_within_baseline():
    fresh = {"v": {"total": 600, "in_stock": 200}}
    baseline = {"v": {"count": 600.0, "stock": 200.0, "samples": 10, "streak": 0}}
    assert health.detect_anomalies(fresh, baseline, {"v": "healthy"}) == []


def test_count_drop_is_anomalous():
    fresh = {"v": {"total": 250, "in_stock": 90}}  # < 50% of 600
    baseline = {"v": {"count": 600.0, "stock": 200.0, "samples": 10, "streak": 0}}
    out = health.detect_anomalies(fresh, baseline, {"v": "healthy"})
    assert len(out) == 1 and out[0]["vendor"] == "v"
    assert any("listings" in r for r in out[0]["reasons"])


def test_in_stock_collapse_is_anomalous_even_with_normal_count():
    # The parsing-regression case: normal listing count, in-stock flipped to ~0.
    fresh = {"v": {"total": 600, "in_stock": 1}}
    baseline = {"v": {"count": 600.0, "stock": 200.0, "samples": 10, "streak": 0}}
    out = health.detect_anomalies(fresh, baseline, {"v": "healthy"})
    assert len(out) == 1
    assert any("in-stock" in r for r in out[0]["reasons"])


def test_in_stock_check_skipped_for_low_baseline_vendors():
    # A vendor that normally has only ~2 in stock shouldn't trip the in-stock rule.
    fresh = {"v": {"total": 600, "in_stock": 0}}
    baseline = {"v": {"count": 600.0, "stock": 2.0, "samples": 10, "streak": 0}}
    assert health.detect_anomalies(fresh, baseline, {"v": "healthy"}) == []


def test_unmatched_spike_is_anomalous():
    # Match-rate erosion: count + in-stock normal (those rules stay silent) but
    # unmatched spikes well above baseline.
    fresh = {"v": {"total": 600, "in_stock": 200}}
    baseline = {"v": {"count": 600.0, "stock": 200.0, "unmatched": 10.0, "samples": 10, "streak": 0}}
    out = health.detect_anomalies(fresh, baseline, {"v": "healthy"}, fresh_unmatched={"v": 40})
    assert len(out) == 1
    assert any("unmatched" in r for r in out[0]["reasons"])
    # the count/in-stock rules did NOT fire
    assert not any("listings" in r or "in-stock" in r for r in out[0]["reasons"])


def test_unmatched_no_anomaly_when_baseline_missing():
    # Migration guard: a legacy baseline with no `unmatched` field must NOT flag,
    # even on a huge spike, until the metric has been seeded.
    fresh = {"v": {"total": 600, "in_stock": 200}}
    baseline = {"v": {"count": 600.0, "stock": 200.0, "samples": 10, "streak": 0}}
    out = health.detect_anomalies(fresh, baseline, {"v": "healthy"}, fresh_unmatched={"v": 500})
    assert out == []


def test_unmatched_skipped_for_tiny_baseline():
    # A vendor that normally has a tiny unmatched count shouldn't trip the rule.
    fresh = {"v": {"total": 600, "in_stock": 200}}
    baseline = {"v": {"count": 600.0, "stock": 200.0, "unmatched": 3.0, "samples": 10, "streak": 0}}
    out = health.detect_anomalies(fresh, baseline, {"v": "healthy"}, fresh_unmatched={"v": 100})
    assert out == []


def test_unmatched_absolute_floor():
    # Dual floor: ratio alone isn't enough — the absolute jump must clear
    # min_unmatched_spike (15). 8→17 is >2x but only +9, so no flag; 8→30 fires.
    fresh = {"v": {"total": 600, "in_stock": 200}}
    baseline = {"v": {"count": 600.0, "stock": 200.0, "unmatched": 8.0, "samples": 10, "streak": 0}}
    assert health.detect_anomalies(fresh, baseline, {"v": "healthy"}, fresh_unmatched={"v": 17}) == []
    out = health.detect_anomalies(fresh, baseline, {"v": "healthy"}, fresh_unmatched={"v": 30})
    assert len(out) == 1 and any("unmatched" in r for r in out[0]["reasons"])


def test_update_baseline_seeds_unmatched_on_legacy_vendor():
    # A mature baseline with no `unmatched` field seeds it on the next healthy run
    # (without resetting count/stock maturity), then EWMA-moves it.
    base = {"v": {"count": 600.0, "stock": 200.0, "samples": 10, "streak": 0}}
    fresh = {"v": {"total": 600, "in_stock": 200}}
    b = health.update_baseline(base, fresh, {"v": "healthy"}, [], "t0", fresh_unmatched={"v": 12})
    assert b["v"]["unmatched"] == 12.0
    assert b["v"]["samples"] == 11  # count/stock maturity preserved + incremented
    b = health.update_baseline(b, fresh, {"v": "healthy"}, [], "t1", fresh_unmatched={"v": 20})
    assert abs(b["v"]["unmatched"] - (0.25 * 20 + 0.75 * 12)) < 1e-9  # 14.0


def test_update_baseline_freezes_unmatched_when_anomalous():
    base = {"v": {"count": 600.0, "stock": 200.0, "unmatched": 10.0, "samples": 10, "streak": 0}}
    fresh = {"v": {"total": 600, "in_stock": 200}}
    anomalies = [{"vendor": "v"}]
    b = health.update_baseline(base, fresh, {"v": "healthy"}, anomalies, "t",
                               fresh_unmatched={"v": 500})
    assert b["v"]["unmatched"] == 10.0  # not dragged up (no boiling-frog)
    assert b["v"]["streak"] == 1


def test_full_flow_unmatched_erosion_escalates():
    # Headline: matched count + in-stock held STEADY (so those rules never fire)
    # while unmatched spikes for 3 runs → sustained anomaly.
    baseline: dict = {}
    decision = {"v": "healthy"}
    for i in range(6):
        fresh = {"v": {"total": 600, "in_stock": 200}}
        an = health.detect_anomalies(fresh, baseline, decision, fresh_unmatched={"v": 20})
        assert an == [], "warmup should be quiet"
        baseline = health.update_baseline(baseline, fresh, decision, an, f"t{i}",
                                          fresh_unmatched={"v": 20})
    assert baseline["v"]["unmatched"] == 20.0
    sustained_seen = False
    for i in range(3):
        fresh = {"v": {"total": 600, "in_stock": 200}}  # matched/in-stock unchanged
        an = health.detect_anomalies(fresh, baseline, decision, fresh_unmatched={"v": 200})
        assert an and all("unmatched" in r for r in an[0]["reasons"]), (
            "only the unmatched rule should fire"
        )
        baseline = health.update_baseline(baseline, fresh, decision, an, f"x{i}",
                                          fresh_unmatched={"v": 200})
        if health.sustained_anomalies(an, baseline):
            sustained_seen = True
    assert sustained_seen and baseline["v"]["streak"] == 3
    assert baseline["v"]["unmatched"] == 20.0  # frozen throughout the break


def test_skips_until_enough_samples():
    fresh = {"v": {"total": 10, "in_stock": 0}}
    baseline = {"v": {"count": 600.0, "stock": 200.0, "samples": 3, "streak": 0}}  # < min_samples
    assert health.detect_anomalies(fresh, baseline, {"v": "healthy"}) == []


def test_only_judges_healthy_vendors():
    fresh = {"v": {"total": 10, "in_stock": 0}}
    baseline = {"v": {"count": 600.0, "stock": 200.0, "samples": 10, "streak": 0}}
    # carried/failed vendors are covered by the floor/staleness path, not here.
    assert health.detect_anomalies(fresh, baseline, {"v": "carried"}) == []
    assert health.detect_anomalies(fresh, baseline, {"v": "failed"}) == []


def test_update_baseline_first_sample_then_ewma():
    b = health.update_baseline({}, {"v": {"total": 100, "in_stock": 40}}, {"v": "healthy"}, [], "t0")
    assert b["v"]["samples"] == 1 and b["v"]["count"] == 100.0 and b["v"]["stock"] == 40.0
    # second healthy run EWMA-moves toward the new value (alpha 0.25)
    b = health.update_baseline(b, {"v": {"total": 200, "in_stock": 80}}, {"v": "healthy"}, [], "t1")
    assert b["v"]["samples"] == 2
    assert abs(b["v"]["count"] - (0.25 * 200 + 0.75 * 100)) < 1e-9  # 125.0
    assert b["v"]["streak"] == 0


def test_update_baseline_anomalous_bumps_streak_and_freezes_value():
    base = {"v": {"count": 600.0, "stock": 200.0, "samples": 10, "streak": 0}}
    fresh = {"v": {"total": 10, "in_stock": 0}}
    anomalies = [{"vendor": "v"}]
    b = health.update_baseline(base, fresh, {"v": "healthy"}, anomalies, "t")
    assert b["v"]["streak"] == 1
    assert b["v"]["count"] == 600.0 and b["v"]["stock"] == 200.0  # not dragged down
    assert b["v"]["samples"] == 10  # samples not incremented while anomalous


def test_update_baseline_leaves_carried_vendor_untouched():
    base = {"v": {"count": 600.0, "stock": 200.0, "samples": 10, "streak": 2}}
    b = health.update_baseline(base, {"v": {"total": 5, "in_stock": 0}}, {"v": "carried"}, [], "t")
    assert b["v"] == base["v"]


def test_streak_resets_on_recovery():
    base = {"v": {"count": 600.0, "stock": 200.0, "samples": 10, "streak": 2}}
    b = health.update_baseline(base, {"v": {"total": 600, "in_stock": 200}}, {"v": "healthy"}, [], "t")
    assert b["v"]["streak"] == 0


def test_sustained_anomalies_gate_on_streak():
    anomalies = [{"vendor": "v", "reasons": ["x"]}]
    base_below = {"v": {"streak": 2}}
    base_at = {"v": {"streak": 3}}
    assert health.sustained_anomalies(anomalies, base_below) == []
    sustained = health.sustained_anomalies(anomalies, base_at)
    assert len(sustained) == 1 and sustained[0]["streak"] == 3


def test_full_flow_warmup_then_sustained_break():
    # Warm up a healthy baseline, then a 3-run in-stock collapse escalates.
    baseline: dict = {}
    decision = {"v": "healthy"}
    for i in range(6):
        fresh = {"v": {"total": 600, "in_stock": 200}}
        an = health.detect_anomalies(fresh, baseline, decision)
        baseline = health.update_baseline(baseline, fresh, decision, an, f"t{i}")
    assert baseline["v"]["samples"] == 6
    # now the scraper flips everything out-of-stock for 3 runs
    sustained_seen = False
    for i in range(3):
        fresh = {"v": {"total": 600, "in_stock": 0}}
        an = health.detect_anomalies(fresh, baseline, decision)
        assert an, "should detect the in-stock collapse"
        baseline = health.update_baseline(baseline, fresh, decision, an, f"x{i}")
        if health.sustained_anomalies(an, baseline):
            sustained_seen = True
    assert sustained_seen and baseline["v"]["streak"] == 3


# --- chronic degradation (rolling carry window) ------------------------------


def _run_window(decisions, baseline=None):
    """Feed a sequence of per-run decisions for one vendor 'v' through the window."""
    baseline = baseline if baseline is not None else {}
    for d in decisions:
        baseline = health.update_carry_window(baseline, {"v": d})
    return baseline


def test_carry_window_records_degraded_runs_not_just_healthy_ones():
    # This is the one signal that must see non-healthy runs — update_baseline
    # deliberately ignores them, which is why chronic flapping was invisible.
    b = _run_window(["healthy", "carried", "failed", "healthy"])
    assert b["v"]["carry_window"] == [0, 1, 1, 0]


def test_carry_window_is_bounded():
    b = _run_window(["carried"] * 40)
    assert len(b["v"]["carry_window"]) == health.DEFAULTS["carry_window"]


def test_not_chronic_before_enough_history():
    # Degraded every run, but too few runs to judge yet.
    n = int(health.DEFAULTS["chronic_min_window"]) - 1
    b = _run_window(["carried"] * n)
    assert b["v"]["chronic"] is False
    assert health.chronic_vendors(b) == []


def test_chronic_opens_at_the_threshold():
    # 12 runs of history with exactly `chronic_open` degraded.
    opens = int(health.DEFAULTS["chronic_open"])
    span = int(health.DEFAULTS["chronic_min_window"])
    b = _run_window(["carried"] * opens + ["healthy"] * (span - opens))
    assert b["v"]["chronic"] is True
    chronic = health.chronic_vendors(b)
    assert [c["vendor"] for c in chronic] == ["v"]
    assert chronic[0]["carried"] == opens and chronic[0]["window"] == span


def test_one_off_blip_is_not_chronic():
    # A single carried run in a full window is exactly what carry-forward is for.
    span = int(health.DEFAULTS["carry_window"])
    b = _run_window(["carried"] + ["healthy"] * (span - 1))
    assert b["v"]["chronic"] is False


def test_chronic_latches_through_the_hysteresis_band():
    # Open it, then sit between chronic_close and chronic_open: stays open, so the
    # tracking issue can't flap open/closed hour to hour.
    span = int(health.DEFAULTS["carry_window"])
    opens = int(health.DEFAULTS["chronic_open"])
    closes = int(health.DEFAULTS["chronic_close"])
    b = _run_window(["carried"] * opens + ["healthy"] * (span - opens))
    assert b["v"]["chronic"] is True
    # Slide the window until the degraded count sits strictly inside the band
    # (above chronic_close, below chronic_open): the latch must hold.
    seen_in_band = False
    while sum(b["v"]["carry_window"]) > closes:
        b = _run_window(["healthy"], b)
        if closes < sum(b["v"]["carry_window"]) < opens:
            seen_in_band = True
            assert b["v"]["chronic"] is True, "must stay latched inside the band"
    assert seen_in_band, "test needs a band between close and open to exercise"
    b = _run_window(["healthy"] * span, b)  # flush the window clean
    assert b["v"]["chronic"] is False, "a fully clean window must clear the latch"


def test_chronic_clears_only_at_the_close_threshold():
    span = int(health.DEFAULTS["carry_window"])
    opens = int(health.DEFAULTS["chronic_open"])
    closes = int(health.DEFAULTS["chronic_close"])
    b = _run_window(["carried"] * opens + ["healthy"] * (span - opens))
    assert b["v"]["chronic"] is True
    # Refill the window so exactly `chronic_close` runs are degraded → clears.
    b = _run_window(["carried"] * closes + ["healthy"] * (span - closes), b)
    assert sum(b["v"]["carry_window"]) == closes
    assert b["v"]["chronic"] is False


def test_carry_window_leaves_vendors_absent_from_this_run_alone():
    b = {"gone": {"carry_window": [1, 1], "chronic": True}}
    out = health.update_carry_window(b, {"v": "healthy"})
    assert out["gone"] == b["gone"]


def test_carry_window_preserves_existing_baseline_fields():
    b = {"v": {"count": 600.0, "stock": 200.0, "samples": 10, "streak": 0}}
    out = health.update_carry_window(b, {"v": "healthy"})
    assert out["v"]["count"] == 600.0 and out["v"]["samples"] == 10


def test_carry_rates_reports_only_vendors_with_history():
    b = _run_window(["carried", "healthy"])
    b["quiet"] = {"count": 1.0}
    rates = health.carry_rates(b)
    assert rates == {"v": {"carried": 1, "window": 2}}


def test_chronic_catches_the_flapping_vendor_staleness_misses():
    # The real shape: ~1 run in 5 degraded, each outage short enough that the
    # published data never goes stale long enough to escalate. update_baseline
    # never sees the bad runs (vendor is carried), so only the carry window
    # can catch it.
    baseline: dict = {}
    for i in range(24):
        d = "carried" if i % 5 == 0 else "healthy"
        baseline = health.update_carry_window(baseline, {"v": d})
    assert sum(baseline["v"]["carry_window"]) == 5
    assert baseline["v"]["chronic"] is True
