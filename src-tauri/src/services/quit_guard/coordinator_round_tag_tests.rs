//! Specification for the ADR-0035 round tag (plan amendment A5): cases RT-1 ..
//! RT-6.
//!
//! Law: a reply is applied iff its round is `None` or equals the request's
//! current round; a refused reply leaves the coordinator bit-for-bit unchanged.
//! `round` starts at 0 and rises by exactly 1 per `Recheck`. Legacy `on_answer`
//! is observationally identical to `on_answer_in(.., None, ..)`.
//!
//! WI-1 scope: the `Drafting` / `Drafted` rows of RT-2 and RT-6 are WI-2's, and
//! RT-4 over every runner row needs the WI-3 re-check runner. Here RT-4 runs
//! over the hand-built RC traces.

use super::super::coordinator_domain_tests::{for_each_row, run, Input};
use super::fixtures::*;
use super::rc3_to;
use super::*;

// --- RT-1: a late Clean from round k is ignored in round k+1 ------------------

#[test]
fn rt1_a_late_clean_from_an_earlier_round_is_ignored() {
    let (mut c, r, _) = rc3_to(4);
    assert_eq!(round(&c), 1);
    let before = c.clone();
    assert_eq!(
        c.on_answer_in(r, Some(0), "b", Answer::Clean, 1050),
        ignored(IgnoredWhy::StaleRound)
    );
    assert_eq!(c, before);
}

// --- RT-2: the acceptance rule over every answering status -------------------

/// `(name, coordinator, request id, label, answer)` in round `current`.
type Row = (&'static str, QuitCoordinator, u64, &'static str, Answer);

fn rows_in_round(current: u32) -> Vec<Row> {
    // RC-3 prefixes reach round 1 (steps 2/4/5) and round 2 (step 6); RC-12's
    // eighth step prompts b in round 2.
    let (pending, prompted, deciding, label) = if current == 1 {
        (rc3_to(2), rc3_to(4), rc3_to(5), "a")
    } else {
        let rc12 = |extra: bool| {
            let (mut c, r, _) = rc3_to(6);
            c.on_answer(r, "a", Answer::Clean, 1600);
            c.on_answer(r, "b", Answer::Dirty, 1700);
            if extra {
                c.on_answer(r, "b", Answer::Delivered, 1800);
            }
            (c, r, Vec::new())
        };
        (rc3_to(6), rc12(false), rc12(true), "b")
    };
    let mut rows: Vec<Row> = Vec::new();
    for answer in [Answer::Clean, Answer::Dirty] {
        rows.push(("recheck-pending", pending.0.clone(), pending.1, "a", answer));
    }
    rows.push(("prompted", prompted.0, prompted.1, label, Answer::Delivered));
    for answer in [discard(&["x"]), Answer::Cancel] {
        rows.push(("deciding", deciding.0.clone(), deciding.1, label, answer));
    }
    rows
}

#[test]
fn rt2_round_tag_acceptance_over_every_answering_status() {
    for current in [1u32, 2] {
        for (name, base, r, label, answer) in rows_in_round(current) {
            assert_eq!(round(&base), current, "{name}: builder reached round");
            for sent in [None, Some(0), Some(1), Some(2), Some(3)] {
                let ctx =
                    format!("status={name} answer={answer:?} sent={sent:?} current={current}");
                let mut c = base.clone();
                let before = c.clone();
                let step = c.on_answer_in(r, sent, label, answer.clone(), 5000);
                if sent.is_none() || sent == Some(current) {
                    assert!(!matches!(step, Step::Ignored { .. }), "{ctx}: {step:?}");
                    assert_ne!(c, before, "{ctx}: an accepted answer must transition");
                } else {
                    assert_eq!(step, ignored(IgnoredWhy::StaleRound), "{ctx}");
                    assert_eq!(c, before, "{ctx}: a refusal must be inert");
                }
            }
        }
    }
}

// --- RT-3: refusal order: StaleRequest and FallbackOwns win over StaleRound --

#[test]
fn rt3_stale_request_and_fallback_outrank_stale_round() {
    let (mut c, r, _) = rc3_to(2);
    let before = c.clone();
    assert_eq!(
        c.on_answer_in(r + 1, Some(0), "a", Answer::Clean, 900),
        ignored(IgnoredWhy::StaleRequest)
    );
    assert_eq!(c, before);

    assert_eq!(
        c.on_tick(2700),
        Step::NativeFallback {
            timed_out: vec!["a".to_string(), "b".to_string()]
        }
    );
    let before = c.clone();
    assert_eq!(
        c.on_answer_in(r, Some(0), "a", Answer::Clean, 2800),
        ignored(IgnoredWhy::FallbackOwns)
    );
    assert_eq!(c, before);
}

// --- RT-4 (WI-1 part): round is monotonic and rises only at Recheck ----------

fn assert_round_series(name: &str, trace: &[(Step, Option<u32>)]) {
    let mut prev = Some(0u32);
    let mut rechecks = 0u32;
    for (i, (step, now)) in trace.iter().enumerate() {
        let ctx = format!("{name} step {i} {step:?}");
        if matches!(step, Step::Recheck { .. }) {
            rechecks += 1;
            assert_eq!(*now, prev.map(|p| p + 1), "{ctx}: a Recheck rises by 1");
        } else if now.is_some() {
            assert_eq!(*now, prev, "{ctx}: only a Recheck changes the round");
        }
        if now.is_some() {
            prev = *now;
        }
    }
    assert_eq!(prev, Some(rechecks), "{name}: final round = Recheck count");
}

#[test]
fn rt4_round_rises_by_one_exactly_at_each_recheck() {
    type Script = Vec<(&'static str, Answer)>;
    let scripts: Vec<(&str, Vec<&str>, Script)> = vec![
        (
            "rc3+rc4",
            vec!["a", "b"],
            vec![
                ("a", Answer::Clean),
                ("b", Answer::Clean),
                ("a", Answer::Dirty),
                ("b", Answer::Clean),
                ("a", Answer::Delivered),
                ("a", discard(&["x"])),
                ("a", Answer::Dirty),
                ("b", Answer::Clean),
            ],
        ),
        (
            "rc7",
            vec!["a"],
            vec![
                ("a", Answer::Dirty),
                ("a", Answer::Delivered),
                ("a", discard(&["x", "y"])),
                ("a", Answer::Dirty),
                ("a", Answer::Delivered),
                ("a", discard(&["y", "z"])),
                ("a", Answer::Clean),
            ],
        ),
    ];
    for (name, labels, script) in scripts {
        let mut c = QuitCoordinator::new();
        let r = begin_later(&mut c, &labels, 0);
        let mut trace = Vec::new();
        let mut last_round = Some(0);
        for (t, (label, answer)) in script.into_iter().enumerate() {
            let step = c.on_answer(r, label, answer, 100 * (t as u64 + 1));
            let now = c.request.as_ref().map(|q| q.round);
            last_round = now.or(last_round);
            trace.push((step, now));
        }
        assert!(last_round >= Some(2), "{name}: two re-check rounds ran");
        assert_round_series(name, &trace);
    }
}

// --- RT-5: the legacy entry equals the round-aware entry with None -----------

fn replay(n: usize, inputs: &[Input], mode: u8) -> (Vec<Step>, QuitCoordinator) {
    let labels: Vec<String> = (0..n).map(|i| format!("w{i}")).collect();
    let mut c = QuitCoordinator::new();
    let id = begin_later(
        &mut c,
        &labels.iter().map(String::as_str).collect::<Vec<_>>(),
        0,
    );
    let mut steps = Vec::new();
    for input in inputs {
        let current = c.request.as_ref().map(|q| q.round);
        let answer = |c: &mut QuitCoordinator, id: u64, label: &str, a: Answer| match mode {
            0 => c.on_answer(id, label, a, 1),
            1 => c.on_answer_in(id, None, label, a, 1),
            _ => c.on_answer_in(id, current, label, a, 1),
        };
        steps.push(match input {
            Input::Answer { idx, answer: a } => answer(&mut c, id, &labels[*idx], a.clone()),
            Input::StaleAnswer { idx, answer: a } => {
                answer(&mut c, id.wrapping_sub(1), &labels[*idx], a.clone())
            }
            Input::ForeignAnswer(a) => answer(&mut c, id, "zz", a.clone()),
            Input::Gone(idx) => c.on_window_gone(&labels[*idx], 1),
            Input::ForeignGone => c.on_window_gone("zz", 1),
            Input::Tick(now) => c.on_tick(*now),
            Input::Fallback(a) => c.on_fallback_answer(id, *a),
        });
    }
    (steps, c)
}

#[test]
fn rt5_legacy_on_answer_equals_on_answer_in_with_none_or_the_current_round() {
    let mut rows = 0usize;
    for_each_row(|assign, order, tick_at, row| {
        let d = run(assign, order, tick_at, row);
        let n = assign.len();
        let legacy = replay(n, &d.inputs, 0);
        let none = replay(n, &d.inputs, 1);
        let current = replay(n, &d.inputs, 2);
        assert_eq!(legacy, none, "{row}: legacy vs None");
        assert_eq!(legacy, current, "{row}: legacy vs Some(current)");
        rows += 1;
    });
    assert!(rows > 0, "the domain enumerated no rows");
}

// --- RT-6 (WI-1 part): Delivered is round-checked too ------------------------

#[test]
fn rt6_delivered_is_round_checked() {
    let (mut c, r, _) = rc3_to(4);
    let before = c.clone();
    assert_eq!(
        c.on_answer_in(r, Some(0), "a", Answer::Delivered, 1050),
        ignored(IgnoredWhy::StaleRound)
    );
    assert_eq!(c, before);
}
