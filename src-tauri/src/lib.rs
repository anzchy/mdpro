pub mod commands;
pub mod launch;
pub mod menu;
pub mod models;
pub mod services;

/// Shared mutex used by all tests that mutate $HOME via std::env::set_var.
/// Both `commands::draft` and `services::draft::migration` tests modify the
/// process-wide HOME env var; a single crate-level lock prevents them from
/// racing with each other across test threads.
#[cfg(test)]
pub(crate) static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
