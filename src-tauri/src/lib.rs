// D160: many test suites are macOS- or unix-only (FSEvents, inodes, chmod,
// symlinks), so off macOS the fixtures and test-only helpers they share look
// dead. Gating each helper to its consumers' target would ripple through a
// dozen modules; this allow covers test builds on other targets only and
// never applies to a macOS build or to any non-test build.
#![cfg_attr(all(test, not(target_os = "macos")), allow(dead_code, unused_imports))]

pub mod commands;
pub mod launch;
pub mod launch_args;
pub mod menu;
pub mod models;
pub mod services;

/// The most documents one window may hold, as far as the Rust side is
/// concerned. The single source of truth for two limits that must agree: the
/// MCP sync payload (`commands::mcp`) and the quit guard's discard list
/// (`services::quit_guard::reply::MAX_DISCARD_IDS`). A window MCP lets hold
/// this many dirty documents must be able to discard all of them on quit.
pub const MAX_DOCUMENTS_PER_WINDOW: usize = 100;

/// Shared mutex used by all tests that mutate $HOME via std::env::set_var.
/// Both `commands::draft` and `services::draft::migration` tests modify the
/// process-wide HOME env var; a single crate-level lock prevents them from
/// racing with each other across test threads.
#[cfg(test)]
pub(crate) static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
