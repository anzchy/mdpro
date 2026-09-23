//! D16F WI-8 (audit rows 11, 12): the two pure helpers in `effects.rs`.
//!
//! - `run_activation` is total and conjunctive: every step runs exactly once,
//!   in slice order, whatever earlier steps returned, and the result is `true`
//!   iff every step was `Ok` ([ADV1-2]).
//! - `report_dispatch` turns a failed main-thread dispatch into exactly one
//!   `app.quit.effect_failed` line, and a successful one into none.
//!
//! The log cases use request ids 8_900 and 8_901, which no guard in the process
//! reaches, and run under `HOME_LOCK` in a temp `$HOME`.

use crate::models::{LogLevel, LogSettings};
use crate::services::logger;
use crate::services::quit_guard::driver_fixtures::{entries_where, fresh_log_home, set_home};
use crate::services::quit_guard::effects::{report_dispatch, run_activation};
use crate::HOME_LOCK;
use serde_json::{json, Value};
use std::cell::RefCell;

/// Runs `n` steps whose failures are the set bits of `mask`. Returns the
/// result, how many steps ran and the order they ran in.
fn run_masked(n: usize, mask: u32) -> (bool, usize, Vec<usize>) {
    let order = RefCell::new(Vec::new());
    let count = RefCell::new(0usize);
    let mut closures: Vec<Box<dyn FnMut() -> Result<(), String>>> = (0..n)
        .map(|i| {
            let order = &order;
            let count = &count;
            Box::new(move || {
                *count.borrow_mut() += 1;
                order.borrow_mut().push(i);
                if mask & (1 << i) != 0 {
                    Err(format!("step {i} failed"))
                } else {
                    Ok(())
                }
            }) as Box<dyn FnMut() -> Result<(), String>>
        })
        .collect();
    let mut steps: Vec<&mut dyn FnMut() -> Result<(), String>> =
        closures.iter_mut().map(|c| c.as_mut() as _).collect();
    let result = run_activation(&mut steps);
    drop(steps);
    drop(closures);
    (result, count.into_inner(), order.into_inner())
}

/// [ADV1-2] Every failure subset over 0..=4 steps (the four-step rows are the
/// production order: activate_app dispatch, unminimize, show, set_focus). This
/// includes the mask where only the app activation fails.
#[test]
fn wi8_run_activation_runs_every_step_in_order_and_is_the_conjunction() {
    for n in 0..=4usize {
        for mask in 0..(1u32 << n) {
            let (result, count, order) = run_masked(n, mask);
            assert_eq!(count, n, "n={n} mask={mask:#b}: every step must run once");
            assert_eq!(
                order,
                (0..n).collect::<Vec<_>>(),
                "n={n} mask={mask:#b}: steps must run in slice order"
            );
            assert_eq!(
                result,
                mask == 0,
                "n={n} mask={mask:#b}: result must be the conjunction"
            );
        }
    }
    let (empty, _, _) = run_masked(0, 0);
    assert!(empty, "no steps is vacuously a success");
    let (app_only, count, _) = run_masked(4, 0b0001);
    assert!(!app_only, "a failed app activation alone is a failure");
    assert_eq!(
        count, 4,
        "a failed app activation must not skip the window calls"
    );
}

fn log_on() {
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
}

fn all(_: &Value) -> bool {
    true
}

#[test]
fn wi8_failed_dispatch_logs_one_timer_dispatch_line() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi8_dispatch_err");
    let _home = set_home(&home);
    log_on();

    report_dispatch(Err::<(), &str>("event loop closed"), 8_900, "timerDispatch");

    let lines = entries_where(&home, "app.quit.effect_failed", 8_900, all);
    assert_eq!(lines.len(), 1, "expected one line: {lines:?}");
    assert_eq!(
        lines[0]["context"],
        json!({ "requestId": 8_900, "effect": "timerDispatch" })
    );
    assert_eq!(lines[0]["status"], json!("fail"));
    assert!(
        !lines[0].to_string().contains("event loop closed"),
        "the dispatch error text is not log material: {}",
        lines[0]
    );
}

#[test]
fn wi8_successful_dispatch_logs_nothing() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi8_dispatch_ok");
    let _home = set_home(&home);
    log_on();

    report_dispatch(Ok::<(), &str>(()), 8_901, "timerDispatch");

    let lines = entries_where(&home, "app.quit.effect_failed", 8_901, all);
    assert_eq!(lines, Vec::<Value>::new());
}
