//! Purpose: the driver side of the stuck-quit escape hatch (ADR-0030, shaped
//! by ADR-0036): "Stop Waiting and Quit…" hands a stuck request to the
//! ADR-0027 native alert without waiting on any webview.
//!
//! Pipeline: escape menu item -> `deliver_escape` -> `QuitGuard::escape` ->
//! `QuitCoordinator::on_escape` -> `app.quit.escape` line -> the driver's
//! existing `fallback` (ADR-0027 alert, released again if it cannot be posted).
//!
//! Key decisions:
//! - **Phase, round and count are read in the same lock acquisition as the
//!   ruling** (`escape_view` inside the `plan` closure), so the line cannot
//!   describe a state the ruling did not see — a racing ack tick included.
//! - **The escape line is written before the alert is posted**, and the plan
//!   never goes through `run`: `run`'s `Plan::Fallback` arm logs
//!   `app.quit.timeout`, and no deadline ran here. The alert itself is the one
//!   ADR-0027 path (`fallback`), including its `effect_failed nativeFallback`
//!   plus `release_fallback` branch.
//! - **No effect runs under the coordinator mutex**: `plan` has returned before
//!   anything is logged or posted, so the nested `runModal` can re-enter.
//! - **Every outcome writes exactly one line**: `fallback`, `noop` (idle,
//!   committed, or `noGuard`), or `ignored` with the coordinator's reason. A
//!   plan `on_escape` cannot return is still run, logged `ignored/unexpected`.
//! - `EscapeSink` mirrors `FallbackSink` / `deliver_fallback` (`events.rs`), so
//!   the menu's routing is testable without an `AppHandle`.
//!
//! @coordinates-with docs/adr/0030-a-menu-item-is-the-escape-hatch-for-a-stuck-quit.md
//! @coordinates-with docs/adr/0036-the-stuck-quit-escape-hatch-is-an-always-enabled-app-menu-item-without-a-shortcut.md
//! @coordinates-with src-tauri/src/services/quit_guard/escape.rs

use super::{logging, IgnoredWhy, Plan, QuitEffects, QuitGuard};
use crate::services::quit_guard::coordinator::EscapePhase;
use crate::services::quit_guard::logging::EscapeOutcome;

/// `reason` when the menu fired but no `AppQuitGuard` was managed.
const REASON_NO_GUARD: &str = "noGuard";
/// `reason` when `on_escape` returned a plan it is not meant to return.
const REASON_UNEXPECTED: &str = "unexpected";

/// Where the escape menu item's click goes. A trait so `deliver_escape` is
/// testable without an `AppHandle`.
pub trait EscapeSink {
    fn escape(&self);
}

impl<E: QuitEffects> EscapeSink for QuitGuard<E> {
    fn escape(&self) {
        QuitGuard::escape(self);
    }
}

/// Hand the escape to the guard, or log that there was none. The menu calls
/// this with `try_state::<AppQuitGuard>()`; a missing guard writes one
/// `noop/noGuard` line instead of dropping the click silently.
pub fn deliver_escape<G: EscapeSink>(guard: Option<&G>) {
    match guard {
        Some(guard) => guard.escape(),
        None => logging::log_escape(
            EscapeOutcome::Noop,
            EscapePhase::Idle,
            None,
            None,
            0,
            Some(REASON_NO_GUARD),
        ),
    }
}

impl<E: QuitEffects> QuitGuard<E> {
    /// The person chose "Stop Waiting and Quit…" (ADR-0030).
    pub fn escape(&self) {
        let mut view = None;
        let (plan, refusal) = self.plan(|c| {
            view = Some(c.escape_view());
            c.on_escape()
        });
        // `plan` always runs its closure; the default is never read.
        let (phase, live, unresolved) = view.map_or((EscapePhase::Idle, None, 0), |v| {
            (v.phase, v.live, v.unresolved)
        });
        let request_id = live.map(|(id, _)| id);
        let round = live.map(|(_, round)| round);
        let log = |outcome, reason| {
            logging::log_escape(outcome, phase, request_id, round, unresolved, reason);
        };
        match plan {
            Plan::Fallback {
                request_id,
                timed_out,
            } => {
                logging::log_escape(
                    EscapeOutcome::Fallback,
                    phase,
                    Some(request_id),
                    round,
                    unresolved,
                    None,
                );
                self.fallback(request_id, timed_out);
            }
            Plan::Nothing => match refusal {
                Some(IgnoredWhy::StaleRequest) => log(EscapeOutcome::Noop, None),
                Some(why) => log(EscapeOutcome::Ignored, Some(why.as_str())),
                None => log(EscapeOutcome::Ignored, Some(REASON_UNEXPECTED)),
            },
            plan @ (Plan::Prompt { .. }
            | Plan::Rearm { .. }
            | Plan::Recheck { .. }
            | Plan::Backstop { .. }
            | Plan::Abort { .. }
            | Plan::Commit { .. }) => {
                log(EscapeOutcome::Ignored, Some(REASON_UNEXPECTED));
                self.run(plan);
            }
        }
    }
}

#[cfg(test)]
#[path = "driver_escape_fixtures.rs"]
mod fixtures;

#[cfg(test)]
#[path = "driver_escape_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "driver_escape_log_tests.rs"]
mod log_tests;
