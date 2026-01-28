use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::json;

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;

#[derive(Default)]
pub struct LaunchState {
    paths: Mutex<Vec<String>>,
}

impl LaunchState {
    pub fn set_paths(&self, paths: Vec<String>) {
        if let Ok(mut data) = self.paths.lock() {
            let paths_for_log = paths.clone();
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "app.launch_state.set".to_string(),
                status: LogStatus::Success,
                action_id: None,
                context: Some(json!({ "count": paths_for_log.len(), "paths": paths_for_log })),
                duration_ms: None,
                error: None,
            });
            *data = paths;
        }
    }

    pub fn take_paths(&self) -> Vec<String> {
        if let Ok(mut data) = self.paths.lock() {
            let paths = data.clone();
            data.clear();
            let paths_for_log = paths.clone();
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "app.launch_state.take".to_string(),
                status: LogStatus::Success,
                action_id: None,
                context: Some(json!({ "count": paths_for_log.len(), "paths": paths_for_log })),
                duration_ms: None,
                error: None,
            });
            return paths;
        }
        Vec::new()
    }
}

pub fn filter_launch_paths<I>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .filter(|arg| !arg.starts_with('-'))
        .filter(|arg| {
            let path = PathBuf::from(arg);
            path.exists()
                && path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
                    .unwrap_or(false)
        })
        .collect()
}
