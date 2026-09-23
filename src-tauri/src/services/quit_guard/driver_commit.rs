//! Purpose: the draft-deletion loop of a committed quit, extracted from
//! `driver.rs` under rule 50 §6 so the driver stays under 300 lines.
//!
//! Key decisions:
//! - The caller holds the draft gate closed for the whole loop (ADR-0025 §4);
//!   this function neither takes nor releases it.
//! - One draft that will not go must not strand the quit: it is counted and
//!   the rest still run.
//!
//! @coordinates-with src/services/quit_guard/driver.rs

use super::{CommitReport, QuitEffects};
use crate::services::draft;

/// Delete each discarded document's draft, telling `effects.on_delete` first.
pub(super) fn delete_discarded<E: QuitEffects>(effects: &E, ids: &[String]) -> CommitReport {
    let mut report = CommitReport::default();
    for id in ids {
        effects.on_delete(id);
        match draft::delete_draft(id) {
            Ok(true) => report.deleted += 1,
            // Nothing to delete: the draft was never written.
            Ok(false) => {}
            Err(_) => report.failed += 1,
        }
    }
    report
}
