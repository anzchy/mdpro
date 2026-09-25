//! The runner's input dispatch: one recorded `Input` to one coordinator call.
//!
//! Split out of `coordinator_runner.rs` (rule 50 §6) when WI-5 added
//! `Input::Escape`, and registered from `coordinator_domain_tests.rs`. It is a
//! free function over a bare `QuitCoordinator`, so the escape laws
//! (`coordinator_escape_props*_tests.rs`) can drive a cloned coordinator with
//! exactly the calls `Runner::feed` makes, without cloning a whole `Runner`.
//!
//! The match is exhaustive, with no `_ =>` arm: a new `Input` fails to compile
//! here until it is given a call.

use super::*;

/// Apply `input` to `c` for request `id` over `labels`, every call at
/// `now_ms = 1`, as `Runner::feed` does.
pub(in super::super) fn dispatch(
    c: &mut QuitCoordinator,
    id: u64,
    labels: &[String],
    input: &Input,
) -> Step {
    match input {
        Input::Answer { idx, answer } => c.on_answer(id, &labels[*idx], answer.clone(), 1),
        Input::StaleAnswer { idx, answer } => {
            c.on_answer(id.wrapping_sub(1), &labels[*idx], answer.clone(), 1)
        }
        Input::ForeignAnswer(answer) => c.on_answer(id, "zz", answer.clone(), 1),
        Input::Gone(idx) => c.on_window_gone(&labels[*idx], 1),
        Input::ForeignGone => c.on_window_gone("zz", 1),
        Input::Tick(now) => c.on_tick(*now),
        Input::Fallback(answer) => c.on_fallback_answer(id, *answer),
        Input::Escape => c.on_escape(),
    }
}
