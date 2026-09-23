//! WI-11 (audit row 21): structural invariants over the phase-2 delivery axis.
//!
//! The rows are `for_each_phase2_row`: every WI2-P1 row, times whether each
//! prompt is acked (`Delivered`) and whether one prompt misses its delivery
//! deadline. The oracle here is structural only. It deliberately says nothing
//! about which discard ids a later `QuitAnyway` would keep: that is audit row 3,
//! triaged to an ADR and still open.

use super::*;

fn is_row3_shape(d: &Runner) -> bool {
    // A discard with real ids, then a later delivery tick that hands over.
    let mut seen_discard = false;
    for (rec, input) in d.trace.iter().zip(&d.inputs) {
        if let (
            Tag::Phase2(_),
            Input::Answer {
                answer: Answer::Discard(ids),
                ..
            },
        ) = (rec.tag, input)
        {
            seen_discard |= !ids.is_empty();
        }
        if matches!(rec.tag, Tag::DeliveryTick(_))
            && matches!(rec.step, Step::NativeFallback { .. })
            && seen_discard
        {
            return true;
        }
    }
    false
}

#[test]
fn wi11_every_row_has_exactly_one_terminal_step() {
    let mut rows = 0usize;
    for_each_phase2_row(|assign, order, tick_at, delivery, row| {
        let d = run_with(assign, order, tick_at, delivery, row);
        let terminals = d.steps().iter().filter(|s| is_terminal(s)).count();
        assert_eq!(
            terminals,
            1,
            "{row}: {terminals} terminals in {:?}",
            d.steps()
        );
        rows += 1;
    });
    assert!(rows > 5_000, "the domain shrank: {rows} rows");
}

#[test]
fn wi11_after_native_fallback_every_input_is_fallback_owns() {
    let mut checked = 0usize;
    for_each_phase2_row(|assign, order, tick_at, delivery, row| {
        let d = run_with(assign, order, tick_at, delivery, row);
        let t = d.terminal_index();
        if !matches!(d.trace[t].step, Step::NativeFallback { .. }) {
            return;
        }
        checked += 1;
        for (rec, input) in d.trace.iter().zip(&d.inputs).skip(t + 1) {
            let stale = matches!(input, Input::StaleAnswer { .. });
            let ok = match &rec.step {
                Step::Ignored {
                    why: IgnoredWhy::FallbackOwns,
                } => true,
                Step::Ignored {
                    why: IgnoredWhy::StaleRequest,
                } => stale,
                _ => false,
            };
            assert!(
                ok,
                "{row}: {input:?} after the fallback gave {:?}",
                rec.step
            );
        }
    });
    assert!(checked > 0, "no row reached the fallback");
}

#[test]
fn wi11_a_tick_after_delivered_waits() {
    let mut late_ticks = 0usize;
    for_each_phase2_row(|assign, order, tick_at, delivery, row| {
        let d = run_with(assign, order, tick_at, delivery, row);
        for rec in &d.trace {
            if matches!(rec.tag, Tag::LateTick(_)) {
                late_ticks += 1;
                assert_eq!(rec.step, Step::Wait, "{row}: a tick measured a person");
            }
        }
    });
    assert!(late_ticks > 0, "no tick ever followed a delivery ack");
}

#[test]
fn wi11_junk_leaves_the_state_unchanged_at_every_position() {
    let mut probes = 0usize;
    for_each_phase2_row(|assign, order, tick_at, delivery, row| {
        if delivery == Delivery::Direct {
            return; // WI2-P4 covers the old axis.
        }
        let n = assign.len();
        let canonical = run_with(assign, order, tick_at, delivery, row);
        let mut d = Runner::new(n, row);
        for k in 0..=canonical.inputs.len() {
            let junks = [
                Input::StaleAnswer {
                    idx: 0,
                    answer: Answer::Clean,
                },
                Input::ForeignAnswer(Answer::Delivered),
                Input::ForeignGone,
            ];
            for junk in junks {
                let mut probe = Runner::new(n, row);
                probe.c = d.c.clone();
                probe.id = d.id;
                let before = probe.c.clone();
                let step = probe.feed(Tag::Junk, junk.clone());
                assert!(
                    matches!(step, Step::Ignored { .. }),
                    "{row}: {junk:?}@{k} gave {step:?}"
                );
                assert_eq!(probe.c, before, "{row}: {junk:?}@{k} moved the state");
                probes += 1;
            }
            if k < canonical.inputs.len() {
                d.feed(Tag::Junk, canonical.inputs[k].clone());
            }
        }
    });
    assert!(probes > 0, "no junk was ever inserted");
}

#[test]
fn wi11_the_runner_really_feeds_delivered_and_phase2_ticks() {
    let (mut delivered_rows, mut tick_fallback_rows, mut tick_wait_rows, mut row3) = (0, 0, 0, 0);
    for_each_phase2_row(|assign, order, tick_at, delivery, row| {
        let d = run_with(assign, order, tick_at, delivery, row);
        let has = |f: &dyn Fn(&Rec) -> bool| d.trace.iter().any(f);
        if has(&|r| matches!(r.tag, Tag::Delivered(_))) {
            delivered_rows += 1;
        }
        if has(&|r| {
            matches!(r.tag, Tag::DeliveryTick(_)) && matches!(r.step, Step::NativeFallback { .. })
        }) {
            tick_fallback_rows += 1;
        }
        if has(&|r| matches!(r.tag, Tag::LateTick(_)) && r.step == Step::Wait) {
            tick_wait_rows += 1;
        }
        if is_row3_shape(&d) {
            row3 += 1;
        }
    });
    assert!(delivered_rows > 0, "no row sent Delivered");
    assert!(
        tick_fallback_rows > 0,
        "no phase-2 tick reached the fallback"
    );
    assert!(tick_wait_rows > 0, "no Delivered -> tick -> Wait row");
    assert!(
        row3 > 0,
        "the discard-then-delivery-timeout sequence never ran"
    );
}

#[test]
fn wi11_row3_discard_then_another_windows_delivery_times_out() {
    // Audit row 3 (ADR-triaged, open): whether `a`'s accepted ids ["da"]
    // survive a `QuitAnyway` on the alert below is the ADR's decision, not this
    // test's. It pins only that the sequence is reachable and hands over.
    let mut c = QuitCoordinator::new();
    let r = match c.begin(&["a", "b"], 0) {
        Begin::Later { request_id } => request_id,
        other => panic!("begin gave {other:?}"),
    };
    c.on_answer(r, "a", Answer::Dirty, 1);
    c.on_answer(r, "b", Answer::Dirty, 1);
    c.on_answer(r, "a", Answer::Delivered, 1);
    let next = c.on_answer(r, "a", Answer::Discard(vec!["da".to_string()]), 1);
    let Step::Prompt { label, deadline_ms } = next else {
        panic!("b was not prompted: {next:?}");
    };
    assert_eq!(label, "b");
    assert_eq!(
        c.on_tick(deadline_ms),
        Step::NativeFallback {
            timed_out: vec!["b".to_string()]
        }
    );
}

#[test]
fn wi11_a_released_fallback_carries_no_deadline() {
    let mut c = QuitCoordinator::new();
    let r = match c.begin(&["a"], 0) {
        Begin::Later { request_id } => request_id,
        other => panic!("begin gave {other:?}"),
    };
    assert!(matches!(
        c.on_tick(QUIT_ACK_TIMEOUT_MS),
        Step::NativeFallback { .. }
    ));
    assert!(c.release_fallback(r));
    assert_eq!(c.request.as_ref().and_then(|q| q.deadline_ms), None);
    assert_eq!(
        c.on_tick(u64::MAX / 2),
        Step::Wait,
        "a release must not re-arm"
    );
}
