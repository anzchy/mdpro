//! WI3-D8's enumeration, split out of `driver_prop_tests.rs` (rule 50 §6): the
//! scenario domain, each scenario driven in given and reversed order through
//! the parent's `check`.
//!
//! Registered from `driver_prop_tests.rs`; runs under `HOME_LOCK` in a temp
//! `$HOME`, because every scenario deletes real drafts.

use super::{check, Kind, KINDS};
use crate::services::quit_guard::driver_fixtures::{make_temp_home, set_home, QuitCommittedReset};
use crate::HOME_LOCK;

#[test]
fn d8_driver_effect_ordering_holds_across_the_coordinator_domain() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d8");
    let _home = set_home(&home);
    let _reset = QuitCommittedReset;

    let mut scenarios: Vec<Vec<Kind>> = Vec::new();
    for a in KINDS {
        scenarios.push(vec![a]);
        for b in KINDS {
            scenarios.push(vec![a, b]);
        }
    }

    // The two rows the test matrix names by hand; enumeration covers them, and
    // this makes it impossible to drop them by shrinking the space later.
    assert!(scenarios.contains(&vec![Kind::GoneAfterDiscard, Kind::Discard]));
    assert!(scenarios.contains(&vec![Kind::GoneAfterDirtyPhase1, Kind::Discard]));
    assert_eq!(scenarios.len(), 56);

    for kinds in &scenarios {
        for reversed in [false, true] {
            check(kinds, reversed, &home);
        }
    }
}
