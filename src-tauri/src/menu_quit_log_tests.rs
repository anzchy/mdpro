//! D190-WI-4: the `app.quit.menu_exit` log context (rule 20).

use super::*;

#[test]
fn ml1_outcome_names_every_begin_and_the_missing_guard() {
    let cases = [
        (Some(Begin::Later { request_id: 9 }), "requested"),
        (Some(Begin::TerminateNow), "terminateNow"),
        (Some(Begin::AlreadyPending), "alreadyPending"),
        (None, "noGuard"),
    ];
    for (begin, want) in cases {
        assert_eq!(exit_outcome_str(begin.as_ref()), want);
    }
}

#[test]
fn ml2_context_is_counts_and_enums_only() {
    let ctx = exit_log_context(Some(&Begin::Later { request_id: 3 }), 2);
    assert_eq!(
        ctx,
        serde_json::json!({ "outcome": "requested", "windowCount": 2 })
    );
}
