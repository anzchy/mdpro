//! Example-based specification for `PendingTable` (matrix Q-1 … Q-11).
//! Ids come from a sequential source, so the n-th enqueue is `r{n}`.

use super::*;

pub(super) fn seq_ids() -> impl IdSource + 'static {
    let mut n = 0u32;
    move || {
        let id = format!("r{n}");
        n += 1;
        id
    }
}

fn table() -> PendingTable<&'static str> {
    PendingTable::new(seq_ids())
}

fn show(w: &str, id: &str) -> Effect {
    Effect::Show {
        window: w.to_string(),
        id: id.to_string(),
    }
}

fn resolve(id: &str, outcome: Outcome) -> Effect {
    Effect::Resolve {
        id: id.to_string(),
        outcome,
    }
}

fn dismiss(w: &str, id: &str) -> Effect {
    Effect::Dismiss {
        window: w.to_string(),
        id: id.to_string(),
    }
}

/// Enqueue `n` requests into `w`, discarding their effects.
fn fill(t: &mut PendingTable<&'static str>, w: &str, n: usize) {
    for _ in 0..n {
        t.enqueue(w, "m");
    }
}

#[test]
fn q1_first_enqueue_shows_second_does_not() {
    let mut t = table();
    assert_eq!(
        t.enqueue("A", "m0"),
        ("r0".to_string(), vec![show("A", "r0")])
    );
    assert_eq!(t.enqueue("A", "m1"), ("r1".to_string(), vec![]));
    assert_eq!(t.pending_len(), 2);
    assert_eq!(t.shown("A"), Some("r0".to_string()));
}

#[test]
fn q2_approve_and_reject_head_resolve_and_advance() {
    let mut t = table();
    fill(&mut t, "A", 3);
    assert_eq!(
        t.reply("r0", "A", true),
        (
            ReplyVerdict::Resolved,
            vec![resolve("r0", Outcome::Approved), show("A", "r1")]
        )
    );
    assert_eq!(
        t.reply("r1", "A", false),
        (
            ReplyVerdict::Resolved,
            vec![resolve("r1", Outcome::Rejected), show("A", "r2")]
        )
    );
}

#[test]
fn q3_duplicate_post_expire_and_unknown_replies_are_noops() {
    let mut t = table();
    fill(&mut t, "A", 2);
    // (a) duplicate
    assert_eq!(t.reply("r0", "A", true).0, ReplyVerdict::Resolved);
    let before = t.pending_len();
    assert_eq!(
        t.reply("r0", "A", true),
        (ReplyVerdict::IgnoredUnknown, vec![])
    );
    assert_eq!(t.pending_len(), before);
    // (b) post-expire: r1 is now the shown head
    assert_eq!(t.expire("r1"), vec![resolve("r1", Outcome::TimedOut)]);
    let before = t.pending_len();
    assert_eq!(
        t.reply("r1", "A", true),
        (ReplyVerdict::IgnoredUnknown, vec![])
    );
    assert_eq!(t.pending_len(), before);
    // (c) never issued
    assert_eq!(
        t.reply("r99", "A", true),
        (ReplyVerdict::IgnoredUnknown, vec![])
    );
    assert_eq!(t.pending_len(), before);
}

#[test]
fn q4_wrong_window_reply_is_ignored_and_head_stays_shown() {
    let mut t = table();
    fill(&mut t, "A", 1);
    assert_eq!(
        t.reply("r0", "B", true),
        (ReplyVerdict::IgnoredWrongWindow, vec![])
    );
    assert_eq!(t.shown("A"), Some("r0".to_string()));
    assert_eq!(
        t.reply("r0", "A", false),
        (
            ReplyVerdict::Resolved,
            vec![resolve("r0", Outcome::Rejected)]
        )
    );
}

#[test]
fn q5_reply_to_queued_not_shown_request_is_ignored() {
    let mut t = table();
    fill(&mut t, "A", 2);
    assert_eq!(
        t.reply("r1", "A", true),
        (ReplyVerdict::IgnoredNotShown, vec![])
    );
    assert_eq!(
        t.reply("r0", "A", true),
        (
            ReplyVerdict::Resolved,
            vec![resolve("r0", Outcome::Approved), show("A", "r1")]
        )
    );
}

#[test]
fn q6_withdraw_dismisses_without_resolving() {
    let mut t = table();
    fill(&mut t, "A", 3);
    assert_eq!(t.withdraw("r1"), vec![]);
    assert_eq!(t.pending_len(), 2);
    assert_eq!(t.withdraw("r0"), vec![dismiss("A", "r0"), show("A", "r2")]);
    assert_eq!(
        t.reply("r1", "A", true),
        (ReplyVerdict::IgnoredUnknown, vec![])
    );
    assert_eq!(t.withdraw("r0"), vec![], "a second withdraw is a no-op");
}

#[test]
fn q7_expire_head_vs_queued() {
    let mut t = table();
    fill(&mut t, "A", 3);
    assert_eq!(t.expire("r1"), vec![resolve("r1", Outcome::TimedOut)]);
    assert_eq!(
        t.expire("r0"),
        vec![resolve("r0", Outcome::TimedOut), show("A", "r2")]
    );
}

#[test]
fn q8_fail_show_cancels_head_as_emit_failed_and_advances() {
    let failed = Outcome::Cancelled(Cause::EmitFailed);
    let mut t = table();
    fill(&mut t, "A", 2);
    assert_eq!(
        t.fail_show("r0"),
        vec![resolve("r0", failed), show("A", "r1")]
    );
    assert_eq!(t.fail_show("r1"), vec![resolve("r1", failed)]);
    assert_eq!(t.fail_show("r7"), vec![]);
    assert_eq!(t.pending_len(), 0);
}

/// Added case: a request that was never shown cannot have failed to show.
#[test]
fn q8b_fail_show_of_queued_request_is_a_noop() {
    let mut t = table();
    fill(&mut t, "A", 2);
    assert_eq!(t.fail_show("r1"), vec![]);
    assert_eq!(t.pending_len(), 2);
    assert_eq!(t.shown("A"), Some("r0".to_string()));
}

#[test]
fn q9_cancel_window_touches_only_that_window() {
    let closed = Outcome::Cancelled(Cause::WindowClosed);
    let mut t = table();
    fill(&mut t, "A", 3);
    fill(&mut t, "B", 1);
    assert_eq!(
        t.cancel_window("A"),
        vec![
            resolve("r0", closed),
            resolve("r1", closed),
            resolve("r2", closed)
        ]
    );
    assert_eq!(t.shown("A"), None);
    assert_eq!(t.shown("B"), Some("r3".to_string()));
    assert_eq!(t.reply("r3", "B", true).0, ReplyVerdict::Resolved);
}

#[test]
fn q10_cancel_all_empties_but_does_not_close() {
    let stop = Outcome::Cancelled(Cause::ServerStop);
    let mut t = table();
    fill(&mut t, "A", 2);
    fill(&mut t, "B", 1);
    assert_eq!(
        t.cancel_all(Cause::ServerStop),
        vec![
            resolve("r0", stop),
            resolve("r1", stop),
            resolve("r2", stop)
        ]
    );
    assert_eq!(t.pending_len(), 0);
    assert!(!t.is_closed());
    assert_eq!(
        t.enqueue("A", "m"),
        ("r3".to_string(), vec![show("A", "r3")])
    );
}

#[test]
fn q11_close_is_absorbing_and_idempotent() {
    let exit = Outcome::Cancelled(Cause::AppExit);
    let mut t = table();
    fill(&mut t, "A", 1);
    assert_eq!(t.close(Cause::AppExit), vec![resolve("r0", exit)]);
    assert!(t.is_closed());
    assert_eq!(t.close(Cause::AppExit), vec![]);
    assert_eq!(
        t.enqueue("A", "m"),
        ("r1".to_string(), vec![resolve("r1", exit)])
    );
    assert_eq!(t.pending_len(), 0);
    assert_eq!(t.cancel_all(Cause::ServerStop), vec![]);
    assert_eq!(t.close(Cause::ServerStop), vec![], "the first cause sticks");
    assert_eq!(t.enqueue("B", "m").1, vec![resolve("r2", exit)]);
}

/// Added case: the broker reads a request's metadata to build its Show
/// payload; it lives exactly as long as the request is pending.
#[test]
fn meta_is_readable_while_pending_only() {
    let mut t = table();
    t.enqueue("A", "first");
    t.enqueue("A", "second");
    assert_eq!(t.meta("r0"), Some(&"first"));
    assert_eq!(t.meta("r1"), Some(&"second"));
    t.reply("r0", "A", true);
    assert_eq!(t.meta("r0"), None);
    t.withdraw("r1");
    assert_eq!(t.meta("r1"), None);
    assert_eq!(t.meta("r9"), None);
}
