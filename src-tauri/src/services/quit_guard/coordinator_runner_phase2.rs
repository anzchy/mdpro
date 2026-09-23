//! The WI-11 (audit row 21) extension of the replay runner: phase-2 delivery.
//!
//! `run_with` drives the same rows as `run`, with one more axis, `Delivery`:
//! whether each prompted window acks its dialog (`Answer::Delivered`) before it
//! decides, and whether one prompt instead misses its delivery deadline.
//! `for_each_phase2_row` enumerates that axis over `for_each_row`.

use super::coordinator_runner::{decide, junk, phase1};
use super::*;

/// How the runner treats each prompt in phase 2.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in super::super) enum Delivery {
    /// No delivery ack: the decision is its own confirmation (the old runner).
    Direct,
    /// Every prompt is acked, then ticked at and far past its deadline.
    Delivered,
    /// Prompt number `k` (0-based) gets a tick at its delivery deadline and no
    /// ack; every earlier prompt is `Delivered`.
    TimeoutAt(usize),
}

/// Every prompt in the runner is issued by an input fed at `now_ms = 1`, so its
/// delivery deadline is here.
pub(in super::super) const DELIVERY_DEADLINE: u64 = 1 + QUIT_PROMPT_DELIVERY_TIMEOUT_MS;

/// A tick far past any deadline, while a person is reading the dialog.
pub(in super::super) const LATE_TICK: u64 = u64::MAX / 2;

/// `run`, with each prompt treated as `delivery` says before it is decided.
pub(in super::super) fn run_with(
    assign: &[Kind],
    order: &[usize],
    tick_at: Option<usize>,
    delivery: Delivery,
    row: &str,
) -> Runner {
    let n = assign.len();
    let mut d = Runner::new(n, row);
    phase1(&mut d, assign, order, tick_at);

    // Phase 2: answer whichever window is prompted, one at a time.
    let mut first_prompt = true;
    let mut guard = 0;
    let mut prompt_no = 0usize;
    while let Some(l) = d.outstanding() {
        guard += 1;
        assert!(guard <= 3 * n + 5, "{row}: prompt loop does not terminate");
        if first_prompt {
            first_prompt = false;
            for (q, kind) in assign.iter().enumerate() {
                if *kind == Kind::GoneWhileQueued {
                    d.feed(Tag::Gone(q), Input::Gone(q));
                }
            }
            if d.outstanding() != Some(l) {
                continue;
            }
        }
        d.clear_outstanding();
        match delivery {
            Delivery::Direct => {}
            Delivery::TimeoutAt(k) if k == prompt_no => {
                d.feed(Tag::DeliveryTick(l), Input::Tick(DELIVERY_DEADLINE));
            }
            Delivery::Delivered | Delivery::TimeoutAt(_) => deliver(&mut d, l),
        }
        prompt_no += 1;
        // After a hand-over this decision arrives late, and must be ignored.
        decide(&mut d, assign, l);
    }
    junk(&mut d);
    d
}

/// The dialog is up: ack it, then tick at its deadline and far past it.
fn deliver(d: &mut Runner, l: usize) {
    d.feed(
        Tag::Delivered(l),
        Input::Answer {
            idx: l,
            answer: Answer::Delivered,
        },
    );
    d.feed(Tag::LateTick(l), Input::Tick(DELIVERY_DEADLINE));
    d.feed(Tag::LateTick(l), Input::Tick(LATE_TICK));
}

/// Every `for_each_row` row, times every `Delivery` that can apply to it.
pub(in super::super) fn for_each_phase2_row(
    mut f: impl FnMut(&[Kind], &[usize], Option<usize>, Delivery, &str),
) {
    for_each_row(|assign, order, tick_at, row| {
        let dirty = dirty_windows_in_snapshot_order(assign).len();
        let mut modes = vec![Delivery::Direct];
        if !assign.contains(&Kind::Timeout) && dirty > 0 {
            modes.push(Delivery::Delivered);
            modes.extend((0..dirty).map(Delivery::TimeoutAt));
        }
        for delivery in modes {
            f(
                assign,
                order,
                tick_at,
                delivery,
                &format!("{row} {delivery:?}"),
            );
        }
    });
}
