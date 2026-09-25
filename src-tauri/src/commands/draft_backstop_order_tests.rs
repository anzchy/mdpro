//! ADR-0035 WI-5: DB-4, split from `draft_backstop_tests` to keep both files
//! under the 300-line limit. Every position a discarded document's draft write
//! can take against the backstop round and the commit ends with it gone.
//!
//! Registered from `commands/mod.rs` beside `draft_backstop_tests`, whose
//! helpers it shares. It runs under `crate::HOME_LOCK` in a fresh temp `$HOME`.

use super::draft::save_draft_gated;
use super::draft_backstop_tests::{
    bundle, discard_then_recheck, guard_over, leak_gate, make_temp_home, recheck_clean, replies,
    set_home,
};
use crate::HOME_LOCK;

// ── DB-4 ──────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug)]
enum WriteAt {
    BeforeBackstop,
    DuringBackstopBeforeDrafted,
    AfterCommit,
}

#[test]
fn db4_every_position_of_a_discarded_docs_write_ends_with_it_gone() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_backstop_db4");
    let _home = set_home(&home);

    for pos in [
        WriteAt::BeforeBackstop,
        WriteAt::DuringBackstopBeforeDrafted,
        WriteAt::AfterCommit,
    ] {
        let id = format!("X-{pos:?}");
        let gate = leak_gate();
        let guard = guard_over(gate);
        let write = || save_draft_gated(gate, &id, "late", None, "t");

        let r = discard_then_recheck(&guard, &id);
        if let WriteAt::BeforeBackstop = pos {
            assert!(
                write().is_ok(),
                "{pos:?}: the gate is open before the backstop"
            );
        }
        recheck_clean(&guard, r);
        if let WriteAt::DuringBackstopBeforeDrafted = pos {
            assert!(write().is_ok(), "{pos:?}: the gate is open in the backstop");
        }
        guard.handle_drafted("a", r, (1, 0), 5);
        assert_eq!(replies(&guard), vec![true], "{pos:?}");
        if let WriteAt::AfterCommit = pos {
            assert!(write().is_err(), "{pos:?}: a write after the commit ran");
        }
        assert!(
            !bundle(&home, &id).exists(),
            "{pos:?}: the discarded draft survived"
        );
    }
}
