//! Test-only seam for the single-handle read in `read_once` (D32 WI-4b,
//! matrix K5; generalised by D86 WI-1, matrix k6-k13).
//!
//! Purpose: let a test run code after the read and before the second fstat
//! of the same handle, so a write, rename or metadata change landing there
//! can be shown to make the read unstable (and every caller fail open); and
//! count `read_once` calls per thread, so a test can show the open path reads
//! the file exactly once (D86 WI-3).
//!
//! @coordinates-with services/file_watcher_baseline_read.rs (`read_once`
//! calls `note_read_call` and `between_read_and_restat`, which production
//! builds compile to empty fns), file_watcher_baseline_save.rs
//! (`refresh_after_save` calls `between_copy_and_store`, likewise; D112), file_watcher_baseline_seed.rs (re-exports
//! `with_read_hook` and `read_once_calls` to `commands` through `kit`), services/file_watcher_baseline.rs (parent; `is_unchanged_with`
//! wraps the test-only `is_unchanged`), file_watcher_baseline_check.rs
//! (`is_unchanged_why` reads through `read_once_upto`, so the hook fires
//! inside it; c6, c10, c11), file_watcher_baseline_coherent_tests.rs (K5, k6-k8,
//! k11), file_watcher_baseline_coherent_race_tests.rs (k9, k10),
//! file_watcher_baseline_read_tests.rs (k13)
//!
//! Key decisions:
//! - **Thread-local, one shot.** `with_read_hook` installs the hook, runs `f`
//!   on the same thread, and always clears the hook afterwards (a drop
//!   guard, so a panic in `f` too), so a hook that never fired (an early
//!   return) cannot leak into a later call on a reused test thread. The
//!   hook is taken before it runs, so a read inside the hook does not fire
//!   it again.
//! - **Any reader**: `register`, `snapshot`, `coherent_read` and
//!   `is_unchanged_why` all reach the hook through `read_once`, so one seam covers
//!   every read the store makes. `refresh_after_save` no longer reads (D112);
//!   it fires the same hook between its copy-out and its store, the window
//!   its read used to open, so the D86 WI-2 g3 legs still land there.
//! - **The hook runs where production runs nothing**, outside the store's
//!   lock: the read module never takes it (r7), and B18′ lists
//!   `between_read_and_restat(` as an I/O name, so no map helper can call it
//!   under the lock.
use super::BaselineStore;
use std::cell::{Cell, RefCell};
use std::path::Path;

type Hook = Box<dyn FnOnce()>;

thread_local! {
    static HOOK: RefCell<Option<Hook>> = RefCell::new(None);
    static READS: Cell<u64> = const { Cell::new(0) };
}

impl BaselineStore {
    /// `is_unchanged`, with `between` run once after the read and before the
    /// second fstat.
    pub(crate) fn is_unchanged_with(&self, raw: &Path, between: impl FnOnce() + 'static) -> bool {
        with_read_hook(between, || self.is_unchanged(raw))
    }
}

/// Test build of the production no-op in `read_once`: run the installed
/// hook, if any.
pub(super) fn between_read_and_restat() {
    if let Some(hook) = HOOK.with(|h| h.borrow_mut().take()) {
        hook();
    }
}

/// Test build of the production no-op in `refresh_after_save`: run the
/// installed hook, if any (D112).
pub(super) fn between_copy_and_store() {
    between_read_and_restat();
}

/// Clears this thread's hook on drop, so `f` panicking cannot leak it.
struct ClearHook;
impl Drop for ClearHook {
    fn drop(&mut self) {
        HOOK.with(|h| h.borrow_mut().take());
    }
}

/// Run `f` with `hook` installed for the next read on this thread, and
/// always clear it afterwards, even if `f` panics.
pub(crate) fn with_read_hook<R>(hook: impl FnOnce() + 'static, f: impl FnOnce() -> R) -> R {
    HOOK.with(|h| *h.borrow_mut() = Some(Box::new(hook)));
    let _clear = ClearHook;
    f()
}

/// How many `read_once` calls this thread has made (D86 WI-3, matrix
/// "runs read_once exactly once"). Monotonic; tests diff two readings.
pub(crate) fn read_once_calls() -> u64 {
    READS.with(Cell::get)
}

/// Test build of the production no-op in `read_once`: count the call.
pub(super) fn note_read_call() {
    READS.with(|n| n.set(n.get() + 1));
}
