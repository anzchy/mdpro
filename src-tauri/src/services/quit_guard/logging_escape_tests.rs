//! WI-2 (plan-20260925-155408): the `app.quit.escape` context builder and its
//! writer.
//!
//! Law: the context is a faithful, count-only projection. `outcome`, `phase`
//! and `unresolvedCount` are always present; `requestId`, `round` and `reason`
//! are present iff their argument is `Some` (absent, never `null`); no other
//! key ever is. Every outcome is written at Info level with status `success`.

// The lg5 `error` check predates the lint and is kept verbatim.
#![allow(clippy::unnecessary_map_or)]

use super::{escape_log_context, log_escape, EscapeOutcome};
use crate::services::quit_guard::coordinator::EscapePhase;
use crate::services::quit_guard::driver_fixtures::{fresh_log_home, log_lines, set_home};
use crate::HOME_LOCK;
use serde_json::{json, Value};
use std::collections::BTreeSet;

use EscapeOutcome::{Fallback, Ignored, Noop};

const OUTCOMES: [(EscapeOutcome, &str); 3] =
    [(Fallback, "fallback"), (Noop, "noop"), (Ignored, "ignored")];

/// The D7 wire strings, one per phase.
const PHASES: [(EscapePhase, &str); 6] = [
    (EscapePhase::Idle, "idle"),
    (EscapePhase::Checking { round: 0 }, "checking"),
    (EscapePhase::AwaitingDelivery, "awaitingDelivery"),
    (EscapePhase::Deciding, "deciding"),
    (EscapePhase::Backstop, "backstop"),
    (EscapePhase::Fallback, "fallback"),
];

fn keys(ctx: &Value) -> BTreeSet<String> {
    ctx.as_object()
        .expect("context is an object")
        .keys()
        .cloned()
        .collect()
}

fn set(items: &[&str]) -> BTreeSet<String> {
    items.iter().map(|s| s.to_string()).collect()
}

#[test]
fn lg1_key_sets_per_outcome_and_liveness() {
    type Row<'a> = (
        EscapeOutcome,
        EscapePhase,
        Option<u64>,
        Option<u32>,
        usize,
        Option<&'a str>,
        Value,
    );
    let rows: [Row; 7] = [
        (
            Fallback,
            EscapePhase::Deciding,
            Some(10_001),
            Some(0),
            1,
            None,
            json!({"outcome":"fallback","phase":"deciding","requestId":10001,"round":0,"unresolvedCount":1}),
        ),
        (
            Ignored,
            EscapePhase::Fallback,
            Some(10_001),
            Some(0),
            1,
            Some("fallbackOwns"),
            json!({"outcome":"ignored","phase":"fallback","requestId":10001,"round":0,"unresolvedCount":1,"reason":"fallbackOwns"}),
        ),
        (
            Ignored,
            EscapePhase::Backstop,
            Some(10_002),
            Some(1),
            2,
            Some("outOfPhase"),
            json!({"outcome":"ignored","phase":"backstop","requestId":10002,"round":1,"unresolvedCount":2,"reason":"outOfPhase"}),
        ),
        (
            Noop,
            EscapePhase::Idle,
            None,
            None,
            0,
            None,
            json!({"outcome":"noop","phase":"idle","unresolvedCount":0}),
        ),
        (
            Noop,
            EscapePhase::Idle,
            None,
            None,
            0,
            Some("noGuard"),
            json!({"outcome":"noop","phase":"idle","unresolvedCount":0,"reason":"noGuard"}),
        ),
        (
            Ignored,
            EscapePhase::Checking { round: 0 },
            Some(3),
            Some(0),
            0,
            Some("unexpected"),
            json!({"outcome":"ignored","phase":"checking","requestId":3,"round":0,"unresolvedCount":0,"reason":"unexpected"}),
        ),
        (
            Fallback,
            EscapePhase::AwaitingDelivery,
            Some(10_003),
            Some(0),
            2,
            None,
            json!({"outcome":"fallback","phase":"awaitingDelivery","requestId":10003,"round":0,"unresolvedCount":2}),
        ),
    ];
    for (i, (outcome, phase, id, round, n, reason, expected)) in rows.into_iter().enumerate() {
        let ctx = escape_log_context(outcome, phase, id, round, n, reason);
        assert_eq!(keys(&ctx), keys(&expected), "row {i}: key set");
        assert_eq!(ctx, expected, "row {i}: values");
    }
}

#[test]
fn lg2_absent_keys_are_absent_not_null_and_zero_is_present() {
    let idle = escape_log_context(Noop, EscapePhase::Idle, None, None, 0, None);
    assert!(idle.get("requestId").is_none(), "requestId must be absent");
    assert!(idle.get("round").is_none(), "round must be absent");
    assert!(idle.get("reason").is_none(), "reason must be absent");
    assert_eq!(idle["unresolvedCount"], json!(0));

    let zero = escape_log_context(
        Fallback,
        EscapePhase::Checking { round: 0 },
        Some(0),
        Some(0),
        0,
        None,
    );
    assert_eq!(zero.get("requestId"), Some(&json!(0)));
    assert_eq!(zero.get("round"), Some(&json!(0)));
    assert_eq!(zero.get("unresolvedCount"), Some(&json!(0)));
}

#[test]
fn lg3_key_presence_is_a_projection_over_the_full_argument_grid() {
    let ids = [None, Some(0), Some(u64::MAX)];
    let rounds = [None, Some(0), Some(u32::MAX)];
    let counts = [0usize, 1, usize::MAX];
    let reasons = [None, Some("fallbackOwns")];
    let mut count = 0usize;
    for (outcome, outcome_wire) in OUTCOMES {
        for (phase, phase_wire) in PHASES {
            for id in ids {
                for round in rounds {
                    for n in counts {
                        for reason in reasons {
                            let ctx = escape_log_context(outcome, phase, id, round, n, reason);
                            let mut want = set(&["outcome", "phase", "unresolvedCount"]);
                            if id.is_some() {
                                want.insert("requestId".into());
                            }
                            if round.is_some() {
                                want.insert("round".into());
                            }
                            if reason.is_some() {
                                want.insert("reason".into());
                            }
                            let at =
                                format!("{outcome:?} {phase:?} {id:?} {round:?} {n} {reason:?}");
                            assert_eq!(keys(&ctx), want, "{at}: key set");
                            assert_eq!(ctx["outcome"], json!(outcome_wire), "{at}");
                            assert_eq!(ctx["phase"], json!(phase_wire), "{at}");
                            assert_eq!(ctx["requestId"].as_u64(), id, "{at}");
                            assert_eq!(ctx["round"].as_u64(), round.map(u64::from), "{at}");
                            assert_eq!(ctx["unresolvedCount"].as_u64(), Some(n as u64), "{at}");
                            assert_eq!(ctx["reason"].as_str(), reason, "{at}");
                            count += 1;
                        }
                    }
                }
            }
        }
    }
    // 3 outcomes x 6 phases x 3 ids x 3 rounds x 3 counts x 2 reasons.
    assert_eq!(count, 972);

    // The `checking` wire string does not depend on the round it carries.
    for round in [1, u32::MAX] {
        let ctx = escape_log_context(
            Fallback,
            EscapePhase::Checking { round },
            None,
            None,
            0,
            None,
        );
        assert_eq!(ctx["phase"], json!("checking"));
    }
}

#[test]
fn lg5_log_escape_writes_one_info_success_line_per_call() {
    use crate::models::{LogLevel, LogSettings};
    use crate::services::logger;

    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("lg5");
    let _restore = set_home(&home);
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });

    const MARK: usize = 9_091;
    log_escape(
        Fallback,
        EscapePhase::Deciding,
        Some(10_990),
        Some(0),
        MARK,
        None,
    );
    log_escape(
        Ignored,
        EscapePhase::Fallback,
        Some(10_990),
        Some(0),
        MARK,
        Some("fallbackOwns"),
    );
    log_escape(Noop, EscapePhase::Idle, None, None, MARK, Some("noGuard"));

    let lines: Vec<Value> = log_lines(&home)
        .into_iter()
        .filter(|v| {
            v.get("event").and_then(Value::as_str) == Some("app.quit.escape")
                && v.pointer("/context/unresolvedCount")
                    .and_then(Value::as_u64)
                    == Some(MARK as u64)
        })
        .collect();
    assert_eq!(lines.len(), 3, "one line per call: {lines:?}");
    let outcomes: Vec<&str> = lines
        .iter()
        .map(|v| v["context"]["outcome"].as_str().unwrap_or(""))
        .collect();
    assert_eq!(outcomes, ["fallback", "ignored", "noop"], "call order");
    for line in &lines {
        assert_eq!(line["level"], json!("info"), "{line}");
        assert_eq!(line["status"], json!("success"), "{line}");
        assert!(
            line.get("error").map_or(true, Value::is_null),
            "no error: {line}"
        );
    }
}
