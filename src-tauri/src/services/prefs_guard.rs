//! Purpose: `PrefsGuard`, the held form of `preferences_rw_lock`, which marks
//! its thread so a nested preferences load is refused instead of deadlocking
//! (ADR-0114, menu plan § 5.6, M1a WI-1).
//!
//! `preferences_rw_lock` is a non-reentrant `std::sync::Mutex`. Six callers
//! hold it across load → update → save, so they load through
//! `load_preferences_locked(&guard)`; the public `load_preferences()` takes the
//! lock itself, and on a thread that already holds a guard it returns
//! `PreferencesError::ReentrantLoad` (and fires a `debug_assert!`) rather than
//! waiting on itself.
//!
//! **Known gap, safe today.** Two sites take the raw lock without a guard, so
//! the marker cannot see them: `services/mcp_launch.rs` (`read_server_enabled_in`,
//! `current_status_in`) and `services/mcp_controller/switch.rs`
//! (`current_status_in`). Both read the file's raw bytes under the lock and
//! never call the loader, so nothing can re-enter there. If a change makes
//! either reach the loader, it switches to `PrefsGuard` in that change
//! (delegator ruling, 2026-10-16; M1b row).
//!
//! @coordinates-with services/preferences.rs — `preferences_rw_lock`,
//!   `load_preferences`, `load_preferences_locked`

use std::cell::Cell;
use std::marker::PhantomData;
use std::sync::{Mutex, MutexGuard};

use crate::services::preferences::{preferences_rw_lock, PreferencesError};

thread_local! {
    /// True while a `PrefsGuard` constructed on this thread is alive.
    static HELD: Cell<bool> = const { Cell::new(false) };
}

/// Why a guard could not be taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuardError {
    /// Another thread panicked while holding the lock.
    Poisoned,
    /// This thread already holds a guard; taking another would deadlock.
    Reentrant,
}

/// The preferences lock, held, with this thread marked for its lifetime.
///
/// Not `Send`: the mark is per thread, so the guard must be dropped on the
/// thread that took it.
pub struct PrefsGuard<'a> {
    _inner: MutexGuard<'a, ()>,
    _not_send: PhantomData<*const ()>,
}

impl PrefsGuard<'static> {
    /// Takes the process-wide `preferences_rw_lock`.
    pub fn acquire() -> Result<Self, GuardError> {
        Self::acquire_in(preferences_rw_lock())
    }
}

impl<'a> PrefsGuard<'a> {
    /// Takes `lock`. The seam tests use with a local mutex, so a panic under
    /// test never poisons the global one.
    ///
    /// The reentry check comes first, and the thread is marked only once the
    /// lock is held, so a refused or poisoned acquire leaves the mark as it was.
    pub fn acquire_in(lock: &'a Mutex<()>) -> Result<Self, GuardError> {
        if HELD.with(Cell::get) {
            return Err(GuardError::Reentrant);
        }
        let inner = lock.lock().map_err(|_| GuardError::Poisoned)?;
        HELD.with(|held| held.set(true));
        Ok(Self {
            _inner: inner,
            _not_send: PhantomData,
        })
    }
}

impl Drop for PrefsGuard<'_> {
    fn drop(&mut self) {
        // Runs on unwind too, so a panic under the guard leaves the thread
        // unmarked; the mutex is released when `_inner` drops after this.
        HELD.with(|held| held.set(false));
    }
}

/// `Err(ReentrantLoad)` when this thread holds a `PrefsGuard`.
///
/// The check the public loader runs before it takes the lock; public so the
/// release-build return path has a direct witness (`cargo test` builds with
/// debug assertions, where the loader panics first).
pub fn reentry_check() -> Result<(), PreferencesError> {
    if HELD.with(Cell::get) {
        Err(PreferencesError::ReentrantLoad)
    } else {
        Ok(())
    }
}

#[cfg(test)]
#[path = "prefs_guard_tests.rs"]
mod prefs_guard_tests;

#[cfg(test)]
#[path = "prefs_guard_callers_tests.rs"]
mod prefs_guard_callers_tests;
