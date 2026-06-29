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

/// True for a markdown extension (case-insensitive).
fn is_markdown_ext(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

/// Filter raw launch arguments down to the markdown files we should open.
///
/// Hardening (SHOULD-FIX): each accepted path is canonicalized, which resolves
/// `..` traversal and symlinks to a real absolute path — so a symlinked or
/// `../`-laden arg opens the actual target, and the emitted path is
/// unambiguous. Only existing *regular files* with a markdown extension pass
/// (directories and special files are dropped). A leading-`-` arg is treated as
/// a CLI flag UNLESS it resolves to an existing file (a file literally named
/// `-notes.md` is still openable). Non-UTF-8 args never reach here — the input
/// is already `String` — but canonicalization output that isn't valid UTF-8 is
/// dropped rather than lossily coerced.
pub fn filter_launch_paths<I>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .filter_map(|arg| {
            let path = PathBuf::from(&arg);

            // A leading '-' is a flag unless it names a real file on disk.
            if arg.starts_with('-') && !path.is_file() {
                return None;
            }

            // Resolve symlinks and `..` traversal to a real absolute path.
            let canonical = path.canonicalize().ok()?;

            // Must be a regular file (not a directory or special file) and a
            // markdown extension.
            if !canonical.is_file() || !is_markdown_ext(&canonical) {
                return None;
            }

            // Drop paths whose canonical form isn't valid UTF-8 rather than
            // lossily coercing (which could open the wrong file).
            canonical.to_str().map(|s| s.to_string())
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
    fn test_filter_resolves_dotdot_traversal_to_canonical_file() {
        // A `..`-laden arg must resolve to the real file, not be dropped.
        let dir = launch_test_dir("traversal");
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let md = dir.join("real.md");
        std::fs::write(&md, b"x").unwrap();
        let traversal = sub.join("..").join("real.md");

        let result = filter_launch_paths(vec![traversal.to_string_lossy().to_string()]);
        assert_eq!(result.len(), 1, "traversal path must resolve, got: {result:?}");
        assert_eq!(
            std::path::PathBuf::from(&result[0]),
            md.canonicalize().unwrap(),
            "emitted path must be canonical"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_filter_resolves_symlink_to_target() {
        use std::os::unix::fs::symlink;
        let dir = launch_test_dir("symlink");
        let target = dir.join("target.md");
        std::fs::write(&target, b"x").unwrap();
        let link = dir.join("link.md");
        symlink(&target, &link).unwrap();

        let result = filter_launch_paths(vec![link.to_string_lossy().to_string()]);
        assert_eq!(result.len(), 1, "symlink must resolve to target, got: {result:?}");
        assert_eq!(
            std::path::PathBuf::from(&result[0]),
            target.canonicalize().unwrap(),
            "symlink must resolve to the real target"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_filter_keeps_file_named_with_leading_dash() {
        // A real file literally named "-notes.md" must still open (not be
        // mistaken for a CLI flag).
        let dir = launch_test_dir("dash_file");
        let md = dir.join("-notes.md");
        std::fs::write(&md, b"x").unwrap();
        // Pass the path as given (it contains the dash in the file name, not at
        // the start of the whole arg since it's an absolute path).
        let result = filter_launch_paths(vec![md.to_string_lossy().to_string()]);
        assert_eq!(result.len(), 1, "leading-dash filename must open, got: {result:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_filter_drops_directory() {
        // A directory with a .md-looking name must not be treated as a file.
        let dir = launch_test_dir("dir_md");
        let fake = dir.join("notebook.md");
        std::fs::create_dir_all(&fake).unwrap();
        let result = filter_launch_paths(vec![fake.to_string_lossy().to_string()]);
        assert!(result.is_empty(), "directory must be dropped, got: {result:?}");
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
