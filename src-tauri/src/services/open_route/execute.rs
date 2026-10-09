//! Pure plan executor (D29 WI-3). Every side effect is an injected closure,
//! so the whole decision is testable without the Tauri runtime.
//!
//! Key decisions:
//! - **Entries run and are logged in input order**, one log per path.
//! - **An emit failure opens a new window for that path, in every context
//!   but a live quit (below), and is never broadcast** (ADR-0033 decision 7): the one window a
//!   broadcast could reach is the one whose emit just failed. The fallback
//!   gets the incoming path, and its log carries the emit error.
//! - **Under a live quit no window is opened at all** (D74): a `Refused`
//!   entry only logs `refused-quit-pending`, and when
//!   `plan.new_windows_refused` an emit failure logs that outcome with its
//!   error instead of falling back to a new window.
//! - **`broadcast` is called at most once**, after the loop, and never with
//!   an empty group.
//! - **The logged `matchCount` is the plan entry's**, never recomputed. A
//!   `new-window` log with `matchCount > 0` is therefore a failed emit.
use super::plan::{route_log_context, Outcome, PlanEntry, RoutePlan, Source};
use super::RouteTarget;
use serde_json::Value;

/// Carry out `plan`. `emit` delivers to an existing window and returns `Err`
/// when it could not; `new_window` opens one path; `broadcast` sends the
/// `file:open` group; `log` receives one `route_log_context` per path, plus
/// the error text when that path's route failed (`None` otherwise).
pub fn execute_plan<E, N, B, L>(
    plan: &RoutePlan,
    source: Source,
    mut emit: E,
    mut new_window: N,
    mut broadcast: B,
    mut log: L,
) where
    E: FnMut(&RouteTarget) -> Result<(), String>,
    N: FnMut(String),
    B: FnMut(Vec<String>),
    L: FnMut(Value, Option<String>),
{
    let mut group = Vec::new();
    for entry in &plan.entries {
        match entry {
            PlanEntry::ExistingWindow {
                path,
                target,
                match_count,
            } => match emit(target) {
                Ok(()) => log(
                    route_log_context(
                        source,
                        Outcome::ExistingWindow,
                        Some(&target.window_label),
                        *match_count,
                    ),
                    None,
                ),
                // D74: under a live quit the fallback window is refused too;
                // the emit error is still reported with the refusal.
                Err(error) if plan.new_windows_refused => log(
                    route_log_context(source, Outcome::RefusedQuitPending, None, *match_count),
                    Some(error),
                ),
                Err(error) => {
                    new_window(path.clone());
                    log(
                        route_log_context(source, Outcome::NewWindow, None, *match_count),
                        Some(error),
                    );
                }
            },
            PlanEntry::NewWindow { path, match_count } => {
                new_window(path.clone());
                log(
                    route_log_context(source, Outcome::NewWindow, None, *match_count),
                    None,
                );
            }
            PlanEntry::Refused { match_count, .. } => log(
                route_log_context(source, Outcome::RefusedQuitPending, None, *match_count),
                None,
            ),
            PlanEntry::Broadcast { path, match_count } => {
                group.push(path.clone());
                log(
                    route_log_context(source, Outcome::Broadcast, None, *match_count),
                    None,
                );
            }
        }
    }
    if !group.is_empty() {
        broadcast(group);
    }
}

#[cfg(test)]
#[path = "execute_log_error_tests.rs"]
mod execute_log_error_tests;
#[cfg(test)]
#[path = "execute_tests.rs"]
mod execute_tests;
