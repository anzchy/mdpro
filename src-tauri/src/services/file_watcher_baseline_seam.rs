//! Test-only seam for the coherent read in `BaselineStore::is_unchanged`
//! (D32 WI-4b, matrix K5).
//!
//! Purpose: let a test run code between the content hash and the second stat,
//! so a write that lands there can be shown to fail the read open.
//!
//! @coordinates-with services/file_watcher_baseline.rs (parent; `is_unchanged`
//! calls `between_read_and_restat`, which production builds compile to an
//! empty fn), file_watcher_baseline_coherent_tests.rs (K5)
//!
//! Key decisions:
//! - **Thread-local, one shot.** `is_unchanged_with` installs the hook, runs
//!   the real `is_unchanged` on the same thread, and always clears the hook
//!   afterwards, so a hook that never fired (an early return) cannot leak into
//!   a later call on a reused test thread.
//! - **The hook runs where production runs nothing**: after the store's lock
//!   has been released by `copy_out`. B18′ lists `between_read_and_restat(` as
//!   an I/O name, so no map helper can call it under the lock.
use super::BaselineStore;
use std::cell::RefCell;
use std::path::Path;

type Hook = Box<dyn FnOnce()>;

thread_local! {
    static HOOK: RefCell<Option<Hook>> = RefCell::new(None);
}

impl BaselineStore {
    /// `is_unchanged`, with `between` run once after the content hash and
    /// before the second stat.
    pub(crate) fn is_unchanged_with(&self, raw: &Path, between: impl FnOnce() + 'static) -> bool {
        HOOK.with(|h| *h.borrow_mut() = Some(Box::new(between)));
        let unchanged = self.is_unchanged(raw);
        HOOK.with(|h| h.borrow_mut().take());
        unchanged
    }

    /// Test build of the production no-op: run the installed hook, if any.
    pub(super) fn between_read_and_restat() {
        if let Some(hook) = HOOK.with(|h| h.borrow_mut().take()) {
            hook();
        }
    }
}
