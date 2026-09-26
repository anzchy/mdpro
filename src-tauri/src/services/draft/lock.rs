//! Purpose: `DRAFT_LOCK`, the one process-wide lock over draft check-then-act
//! (ADR-0038 §4).
//!
//! Key decisions:
//! - Held by `save_draft_as` around its write, and by guarded recover,
//!   guarded discard and cleanup from their check through their write or
//!   delete. `delete_draft` stays lock-free: a successful save deletes its
//!   own draft while the document is still open.
//! - Lock order: `DraftGate` (gated save and recover only) → `DRAFT_LOCK` →
//!   shadow-store mutex. The last is taken inside the `make_ctx` provider
//!   that the `*_with` recover/discard/cleanup call after taking this lock
//!   (`commands::draft_recovery::live_context`). Nothing may take this lock
//!   while holding the shadow store.
//! - Poison-tolerant: the guarded value is `()`, so a panicking holder cannot
//!   have torn it, and refusing would strand every later draft save.
#[cfg(test)]
use std::sync::TryLockError;
use std::sync::{Mutex, MutexGuard};

static DRAFT_LOCK: Mutex<()> = Mutex::new(());

/// Take the draft lock, recovering it if a previous holder panicked.
pub(crate) fn draft_lock() -> MutexGuard<'static, ()> {
    DRAFT_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Whether some thread holds the draft lock right now. Test-only: callers
/// hold `crate::HOME_LOCK` so no other draft test can be the holder.
#[cfg(test)]
pub(crate) fn draft_lock_is_held() -> bool {
    matches!(DRAFT_LOCK.try_lock(), Err(TryLockError::WouldBlock))
}

#[cfg(all(test, unix))]
#[path = "ctx_under_lock_tests.rs"]
mod ctx_under_lock_tests;
#[cfg(all(test, unix))]
#[path = "lock_race_tests.rs"]
mod lock_race_tests;
#[cfg(test)]
#[path = "lock_tests.rs"]
mod lock_tests;
