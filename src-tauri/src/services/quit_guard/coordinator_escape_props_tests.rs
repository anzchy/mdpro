//! WI-5: the escape laws E1-E3 over every reachable prefix of every canonical
//! run in the three exhaustive domains (phase 1 `for_each_row`, phase 2
//! `for_each_phase2_row` × `Delivery`, re-check `for_each_recheck_row`), plus
//! rn1, the runner guard. E4-E6 are in `coordinator_escape_props_rel_tests.rs`.
//!
//! `Input::Escape` is never part of a canonical run. It is injected here, at
//! every position `k` (0 ≤ k ≤ len): the coordinator before input `k` is
//! rebuilt from the recorded inputs with `dispatch`, cloned, and escaped. The
//! expected verdict is derived from the trace prefix, and cross-checked
//! against one derived from the state, independently of `on_escape`.

use super::coordinator_escape_props_fixtures::*;
use super::*;

/// E1: `[rows, live, owns, out of phase, stale, deciding live, queued live]`.
fn e1(dom: Dom) -> [usize; 7] {
    let mut n = [0usize; 7];
    n[0] = for_each_run(dom, |d| {
        for (k, c) in states(d).iter().enumerate() {
            let v = trace_verdict(&d.trace[..k]);
            assert_eq!(v, state_verdict(c), "{} @{k}: trace vs state", d.row);
            let mut e = c.clone();
            assert_eq!(e.on_escape(), expected(v, c), "{} @{k}", d.row);
            n[1 + v as usize] += 1;
            if v == Verdict::Live {
                n[5] += usize::from(has(c, Status::Deciding));
                n[6] += usize::from(has(c, Status::Queued));
            }
        }
    });
    n
}

#[test]
fn e1_escape_at_every_prefix_phase1() {
    let n = e1(Dom::Phase1);
    assert!(n[0] > 1_000, "phase-1 rows: {n:?}");
    assert!(n[1] > 0 && n[2] > 0 && n[4] > 0 && n[6] > 0, "{n:?}");
}

#[test]
fn e1_escape_at_every_prefix_phase2() {
    let n = e1(Dom::Phase2);
    assert!(n[0] > 5_000, "phase-2 rows: {n:?}");
    assert!(
        n[1] > 0 && n[2] > 0 && n[4] > 0 && n[5] > 0 && n[6] > 0,
        "{n:?}"
    );
}

#[test]
fn e1_escape_at_every_prefix_recheck() {
    let n = e1(Dom::Recheck);
    assert!(n[0] >= RECHECK_MIN_ROWS, "re-check rows: {n:?}");
    assert!(n.iter().all(|x| *x > 0), "{n:?}");
}

/// E2: `(rows, live injection points)`.
fn e2(dom: Dom) -> (usize, usize) {
    let mut points = 0usize;
    let probes = [
        Input::Escape,
        Input::Tick(u64::MAX),
        Input::ForeignAnswer(Answer::Clean),
        Input::ForeignGone,
        Input::StaleAnswer {
            idx: 0,
            answer: Answer::Clean,
        },
    ];
    let rows = for_each_run(dom, |d| {
        for (k, c) in states(d).iter().enumerate() {
            let mut s = c.clone();
            if alerts(&s.on_escape()) == 0 {
                continue;
            }
            points += 1;
            let mut e = s.clone();
            let tail = d.inputs[k..]
                .iter()
                .take_while(|i| !matches!(i, Input::Fallback(_)));
            for input in tail.chain(probes.iter()) {
                let why = match input {
                    Input::StaleAnswer { .. } => IgnoredWhy::StaleRequest,
                    _ => IgnoredWhy::FallbackOwns,
                };
                let step = dispatch(&mut e, d.id, &d.labels, input);
                assert_eq!(step, Step::Ignored { why }, "{} @{k}: {input:?}", d.row);
                assert!(e == s, "{} @{k}: {input:?} moved the state", d.row);
            }
            for l in &d.labels {
                let why = IgnoredWhy::FallbackOwns;
                assert_eq!(e.on_delivery_failed(d.id, l), Step::Ignored { why });
                assert!(e == s, "{} @{k}: delivery-failed {l} moved it", d.row);
            }
        }
    });
    (rows, points)
}

#[test]
fn e2_fallback_ownership_is_absorbing_phase1() {
    let (rows, points) = e2(Dom::Phase1);
    assert!(
        rows > 1_000 && points > rows,
        "{rows} rows, {points} points"
    );
}

#[test]
fn e2_fallback_ownership_is_absorbing_phase2() {
    let (rows, points) = e2(Dom::Phase2);
    assert!(
        rows > 5_000 && points > rows,
        "{rows} rows, {points} points"
    );
}

#[test]
fn e2_fallback_ownership_is_absorbing_recheck() {
    let (rows, points) = e2(Dom::Recheck);
    assert!(
        rows >= RECHECK_MIN_ROWS && points > rows,
        "{rows} / {points}"
    );
}

/// E3 over one row: 0, 1 and 2 escapes (k1 ≤ k2), counting every alert in
/// the full canonical tail. Returns `(runs checked, a timer alert preceded k1)`.
/// After the second escape, a state equal to the one-escape run's at `k2`
/// reuses that run's tail count: `dispatch` is deterministic, so equal states
/// fed equal inputs return equal steps. A changed state is fed in full.
fn e3_row(d: &Runner, all_pairs: bool) -> (usize, bool) {
    let st = states(d);
    let len = d.inputs.len();
    let mut pre = vec![0usize];
    for r in &d.trace {
        pre.push(pre.last().unwrap() + alerts(&r.step));
    }
    assert!(pre[len] <= 1, "{}: {} alerts, no escape", d.row, pre[len]);
    let t = d.trace.iter().position(|r| is_terminal(&r.step));
    let (mut runs, mut timer_first) = (1usize, false);
    for k1 in 0..=len {
        let mut c = st[k1].clone();
        let base = pre[k1] + alerts(&c.on_escape());
        timer_first |= pre[k1] > 0;
        let k2s: Vec<usize> = if all_pairs {
            (k1..=len).collect()
        } else {
            let mut v = vec![k1, t.unwrap_or(len).max(k1)];
            v.dedup();
            v
        };
        let (mut snaps, mut flags) = (Vec::new(), Vec::new());
        for p in k1..=len {
            if k2s.contains(&p) {
                snaps.push((p, c.clone()));
            }
            if p < len {
                flags.push(alerts(&dispatch(&mut c, d.id, &d.labels, &d.inputs[p])));
            }
        }
        let one: usize = base + flags.iter().sum::<usize>();
        assert!(one <= 1, "{}: escape @{k1} gave {one} alerts", d.row);
        for (k2, s) in snaps {
            let mut c2 = s.clone();
            let mid = base + flags[..k2 - k1].iter().sum::<usize>() + alerts(&c2.on_escape());
            let rest: usize = if c2 == s {
                flags[k2 - k1..].iter().sum()
            } else {
                let tail = &d.inputs[k2..];
                let steps = tail.iter().map(|i| dispatch(&mut c2, d.id, &d.labels, i));
                steps.map(|s| alerts(&s)).sum()
            };
            let total = mid + rest;
            assert!(total <= 1, "{}: escapes @{k1},{k2}: {total} alerts", d.row);
            runs += 2;
        }
    }
    (runs, timer_first)
}

fn e3(dom: Dom, all_pairs: bool) -> (usize, usize, usize) {
    let (mut runs, mut timer_first) = (0usize, 0usize);
    let rows = for_each_run(dom, |d| {
        let (r, t) = e3_row(d, all_pairs);
        runs += r;
        timer_first += usize::from(t);
    });
    (rows, runs, timer_first)
}

#[test]
fn e3_at_most_one_alert_per_request_phase1() {
    let (rows, runs, timer_first) = e3(Dom::Phase1, true);
    assert!(
        rows > 1_000 && runs > rows && timer_first > 0,
        "{rows} {runs}"
    );
}

#[test]
fn e3_at_most_one_alert_per_request_phase2() {
    let (rows, runs, timer_first) = e3(Dom::Phase2, true);
    assert!(
        rows > 5_000 && runs > rows && timer_first > 0,
        "{rows} {runs}"
    );
}

/// D6: k2 ∈ {k1, terminal} on the re-check domain, for cost.
#[test]
fn e3_at_most_one_alert_per_request_recheck() {
    let (rows, runs, timer_first) = e3(Dom::Recheck, false);
    assert!(rows >= RECHECK_MIN_ROWS && runs > rows && timer_first > 0);
}

#[test]
fn rn1_replay_tags_escape_as_escape_not_junk() {
    let (d, _) = replay(2, &[Input::Escape, Input::Tick(T)], None, "rn1");
    assert_eq!(d.trace[0].tag, Tag::Escape);
    let timed_out = vec!["w0".to_string(), "w1".to_string()];
    assert_eq!(d.trace[0].step, Step::NativeFallback { timed_out });
    let why = IgnoredWhy::FallbackOwns;
    assert_eq!(d.trace[1].step, Step::Ignored { why });
}
