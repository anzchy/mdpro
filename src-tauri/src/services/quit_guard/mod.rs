//! Purpose: the guarded app-quit path (D16).
//!
//! Pipeline: `applicationShouldTerminate:` (WI-4) -> driver (WI-3) ->
//! `coordinator` (this work item) -> NSApp reply.
//!
//! Key decisions:
//! - The decision logic is a pure state machine in `coordinator`: no
//!   `AppHandle`, no objc, no clock. It compiles on every platform.
//! - Only the hook and the effects adapter are `cfg(target_os = "macos")`.
//!
//! @coordinates-with docs/adr/0025-app-quit-is-deferred-through-a-native-terminate-hook.md
//! @coordinates-with docs/adr/0027-a-quit-ack-timeout-draws-a-native-alert.md

pub mod coordinator;
mod types;
