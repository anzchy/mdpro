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

#[cfg(test)]
mod tests {
    use super::*;

    fn launch_test_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join("mdpro_launch_test")
            .join(format!("{label}_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_filter_keeps_existing_markdown_files() {
        let dir = launch_test_dir("keep_md");
        let md = dir.join("note.md");
        let markdown = dir.join("doc.markdown");
        std::fs::write(&md, b"x").unwrap();
        std::fs::write(&markdown, b"x").unwrap();

        let result = filter_launch_paths(vec![
            md.to_string_lossy().to_string(),
            markdown.to_string_lossy().to_string(),
        ]);
        assert_eq!(result.len(), 2, "both markdown files should pass: {result:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_filter_drops_flag_arguments() {
        // Tauri/CLI flags (e.g. --foo) must never be treated as file paths.
        let result = filter_launch_paths(vec!["--devtools".to_string(), "-v".to_string()]);
        assert!(result.is_empty(), "flags must be dropped, got: {result:?}");
    }

    #[test]
    fn test_filter_drops_nonexistent_path() {
        let result =
            filter_launch_paths(vec!["/nonexistent/mdpro/ghost.md".to_string()]);
        assert!(result.is_empty(), "missing file must be dropped, got: {result:?}");
    }

    #[test]
    fn test_filter_drops_existing_non_markdown_file() {
        let dir = launch_test_dir("drop_txt");
        let txt = dir.join("data.txt");
        std::fs::write(&txt, b"x").unwrap();
        let result = filter_launch_paths(vec![txt.to_string_lossy().to_string()]);
        assert!(result.is_empty(), "non-markdown file must be dropped, got: {result:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_filter_extension_match_is_case_insensitive() {
        let dir = launch_test_dir("case_md");
        let md = dir.join("NOTE.MD");
        std::fs::write(&md, b"x").unwrap();
        let result = filter_launch_paths(vec![md.to_string_lossy().to_string()]);
        assert_eq!(result.len(), 1, "uppercase .MD should match, got: {result:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_launch_state_set_then_take_returns_and_clears() {
        let state = LaunchState::default();
        state.set_paths(vec!["/a.md".to_string(), "/b.md".to_string()]);
        let taken = state.take_paths();
        assert_eq!(taken, vec!["/a.md".to_string(), "/b.md".to_string()]);
        // A second take must be empty — take is destructive (avoids re-opening
        // the same files on a later check).
        assert!(state.take_paths().is_empty(), "paths must clear after take");
    }
}
