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
//! - **The broadcast group is delivered at most once, to one label, before
//!   the per-path logs** (D279): only when `broadcast_target` resolved a
//!   window and the group is non-empty, and never retried. It is therefore
//!   sent before any `file:open-in-window` emit (ruling R4).
//! - **No live window drops the group** (D279 Q1): nothing is sent or
//!   opened, and each broadcast path is logged with `no_live_window`.
//! - **A failed send falls back per path** (D279 R2, ADR-0033 decision 7):
//!   a new window each, or `refused-quit-pending` under a live quit (D74).
//!   The line keeps the resolved `via` and carries the send error. A send
//!   fails only when the window was already gone at the glue's lookup; a
//!   window that closes between that lookup and `emit_to` still reports
//!   success, so its open is dropped and logged `broadcast`, as before D279
//!   (closing it needs a delivery ack, an IPC change left to its own D item).
//! - **The logged `matchCount` is the plan entry's**, never recomputed. A
//!   `new-window` log with `matchCount > 0` is therefore a failed emit.
use super::plan::{
    broadcast_route_log_context, fallback_route_log_context, route_log_context, Outcome, PlanEntry,
    RoutePlan, Source,
};
use super::RouteTarget;
use crate::menu::menu_target::Resolved;
use serde_json::Value;

/// Carry out `plan`. `emit` delivers to an existing window and returns `Err`
/// when it could not; `new_window` opens one path; `broadcast(label, group)`
/// sends the `file:open` group to the window `broadcast_target` resolved and
/// returns `Err` when it could not; `log` receives one context per path, plus
/// the error text when that path's route failed (`None` otherwise).
pub fn execute_plan<E, N, B, L>(
    plan: &RoutePlan,
    source: Source,
    broadcast_target: &Resolved,
    mut emit: E,
    mut new_window: N,
    mut broadcast: B,
    mut log: L,
) where
    E: FnMut(&RouteTarget) -> Result<(), String>,
    N: FnMut(String),
    B: FnMut(&str, Vec<String>) -> Result<(), String>,
    L: FnMut(Value, Option<String>),
{
    let group: Vec<String> = plan
        .entries
        .iter()
        .filter_map(|entry| match entry {
            PlanEntry::Broadcast { path, .. } => Some(path.clone()),
            PlanEntry::ExistingWindow { .. }
            | PlanEntry::NewWindow { .. }
            | PlanEntry::Refused { .. } => None,
        })
        .collect();
    // The one delivery: `None` when nothing was sent, else the send's error.
    let send_error = match broadcast_target {
        Ok((label, _)) if !group.is_empty() => broadcast(label, group).err(),
        Ok(_) | Err(_) => None,
    };
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
                let context = broadcast_route_log_context(source, broadcast_target, *match_count);
                match (broadcast_target, &send_error) {
                    (Err(reason), _) => log(context, Some(reason.as_str().to_string())),
                    (Ok(_), None) => log(context, None),
                    // D279 R2 under D74: the fallback window is refused too.
                    (Ok((_, via)), Some(error)) if plan.new_windows_refused => log(
                        fallback_route_log_context(
                            source,
                            Outcome::RefusedQuitPending,
                            *via,
                            *match_count,
                        ),
                        Some(error.clone()),
                    ),
                    (Ok((_, via)), Some(error)) => {
                        new_window(path.clone());
                        log(
                            fallback_route_log_context(
                                source,
                                Outcome::NewWindow,
                                *via,
                                *match_count,
                            ),
                            Some(error.clone()),
                        );
                    }
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "execute_log_error_tests.rs"]
mod execute_log_error_tests;
#[cfg(test)]
#[path = "execute_tests.rs"]
mod execute_tests;
