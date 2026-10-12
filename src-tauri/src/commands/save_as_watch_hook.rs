//! Test-only seam for `save_as_watched_with` (D69): run code after the save
//! returned and before the watch is registered, the window a re-snapshot
//! would baseline.
//!
//! Purpose: `install` a one-shot hook on this thread; the seam's
//! `between_save_and_register` fires it. Split out of save_as_watch.rs to
//! keep that file under the 300-line limit (rule 50).
//!
//! @coordinates-with commands/save_as_watch.rs (parent; calls
//! `between_save_and_register`)
use std::cell::RefCell;

type Hook = Box<dyn FnOnce()>;

thread_local! {
    static HOOK: RefCell<Option<Hook>> = RefCell::new(None);
}

/// Clears this thread's hook on drop, fired or not.
pub(crate) struct HookGuard;
impl Drop for HookGuard {
    fn drop(&mut self) {
        HOOK.with(|h| h.borrow_mut().take());
    }
}

/// Install `hook` for the next Save As on this thread.
pub(crate) fn install(hook: impl FnOnce() + 'static) -> HookGuard {
    HOOK.with(|h| *h.borrow_mut() = Some(Box::new(hook)));
    HookGuard
}

pub(super) fn between_save_and_register() {
    if let Some(hook) = HOOK.with(|h| h.borrow_mut().take()) {
        hook();
    }
}
