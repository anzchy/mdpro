//! Serializes Save As eligibility and writes with document hold acquisition.
use std::sync::OnceLock;
use tokio::sync::{Mutex, MutexGuard};

pub(crate) async fn lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().await
}
