use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;

use super::{drafts_dir, ensure_dir, DraftError};

/// One-time migration: move draft files from the legacy `~/.mdpro/drafts`
/// location (used before fix/audit-128) to the current data_dir location
/// (`~/Library/Application Support/mdpro/drafts` on macOS).
///
/// Idempotent: if the legacy directory does not exist or is empty, returns 0
/// immediately. Existing files at the destination are never overwritten — the
/// newer (destination) copy wins, so re-running after a partial migration is
/// always safe.
///
/// Only `.draft.json`, `.draft.md`, and `.meta.json` regular files are migrated;
/// directories and symlinks in the legacy directory are skipped.
pub fn migrate_legacy_drafts() -> Result<usize, DraftError> {
    let legacy_dir = match legacy_drafts_dir() {
        Some(p) => p,
        None => return Ok(0),
    };

    if !legacy_dir.exists() {
        return Ok(0);
    }

    let target_dir = drafts_dir()?;
    ensure_dir(&target_dir)?;

    let mut migrated = 0;

    let entries = fs::read_dir(&legacy_dir).map_err(|e| DraftError::IoError {
        message: e.to_string(),
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| DraftError::IoError {
            message: e.to_string(),
        })?;

        // Skip anything that is not a plain regular file (directories, symlinks).
        // Use symlink_metadata so we inspect the entry itself, not the symlink target.
        let file_type = match entry.path().symlink_metadata() {
            Ok(m) => m.file_type(),
            Err(_) => continue,
        };
        if !file_type.is_file() {
            continue;
        }

        let src = entry.path();
        let file_name = match src.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        // Only migrate known draft file extensions.
        if !file_name.ends_with(".draft.json")
            && !file_name.ends_with(".draft.md")
            && !file_name.ends_with(".meta.json")
        {
            continue;
        }

        let dst = target_dir.join(&file_name);

        // Never overwrite an existing destination — the destination copy wins.
        if dst.exists() {
            continue;
        }

        // Try atomic rename first (same filesystem).
        match fs::rename(&src, &dst) {
            Ok(()) => {
                migrated += 1;
            }
            Err(rename_err) => {
                // Only fall back to copy+delete for cross-device errors (EXDEV).
                // Any other error (including a race where dst now exists) is left
                // as-is so we never silently overwrite a destination file.
                if is_cross_device(&rename_err) {
                    // Use create_new so we fail atomically if dst appeared since
                    // the rename attempt — never overwrite an existing destination.
                    let copy_result = copy_new(&src, &dst);
                    match copy_result {
                        Ok(()) => {
                            let _ = fs::remove_file(&src);
                            migrated += 1;
                        }
                        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                            // Destination appeared between rename and copy; skip.
                        }
                        Err(_) => {
                            // Copy failed — leave the file in place (better to keep
                            // it than lose it). Next launch will retry.
                        }
                    }
                }
                // For all non-EXDEV rename errors: leave file in place, retry next launch.
            }
        }
    }

    // Best-effort cleanup: remove the old directory only if it is now empty.
    let _ = fs::remove_dir(&legacy_dir);

    Ok(migrated)
}

/// Legacy draft storage path: `~/.mdpro/drafts`. `pub(crate)` so the
/// run-isolation test (ADR-0047 WI-002 WI-8) can resolve it under a temp HOME.
pub(crate) fn legacy_drafts_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".mdpro").join("drafts"))
}

/// EXDEV (cross-device rename) — POSIX errno 18 on macOS and Linux.
/// `std::io::ErrorKind` does not yet expose this variant.
#[cfg(unix)]
const EXDEV: i32 = 18;

/// ERROR_NOT_SAME_DEVICE — Win32 error 17, the Windows equivalent of EXDEV.
#[cfg(not(unix))]
const ERROR_NOT_SAME_DEVICE: i32 = 17;

/// Returns true when the I/O error is a cross-device rename error.
fn is_cross_device(e: &io::Error) -> bool {
    #[cfg(unix)]
    {
        e.raw_os_error() == Some(EXDEV)
    }
    #[cfg(not(unix))]
    {
        e.raw_os_error() == Some(ERROR_NOT_SAME_DEVICE)
    }
}

/// Copy `src` to `dst`, failing atomically with `AlreadyExists` if `dst` already
/// exists. Uses `OpenOptions::create_new` so the check-and-create is atomic from
/// the OS perspective.
fn copy_new(src: &std::path::Path, dst: &std::path::Path) -> io::Result<()> {
    let data = fs::read(src)?;
    OpenOptions::new()
        .write(true)
        .create_new(true) // fails with AlreadyExists if dst was created concurrently
        .open(dst)?
        .write_all(&data)?;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // Use the crate-level HOME_LOCK so that services::draft::migration tests and
    // commands::draft tests cannot race on the process-wide $HOME.
    // HomeRestorer's Drop always restores $HOME even on panic; unwrap_or_else
    // recovers from any poison so subsequent tests can still acquire the lock.
    use crate::HOME_LOCK;

    fn make_temp_home(label: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join("mdpro_migration_test")
            .join(label);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    struct HomeRestorer(Option<String>);
    impl Drop for HomeRestorer {
        fn drop(&mut self) {
            match &self.0 {
                Some(v) => unsafe { std::env::set_var("HOME", v) },
                None => unsafe { std::env::remove_var("HOME") },
            }
        }
    }

    fn set_home(path: &std::path::Path) -> HomeRestorer {
        let prev = std::env::var("HOME").ok();
        unsafe { std::env::set_var("HOME", path.to_str().unwrap()) };
        HomeRestorer(prev)
    }

    /// Build the expected target directory given the current $HOME.
    fn target_dir() -> PathBuf {
        dirs::data_dir()
            .expect("data_dir must be resolvable")
            .join("mdpro")
            .join("drafts")
    }

    #[test]
    fn migrate_no_legacy_dir_returns_zero() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = make_temp_home("no_legacy");
        let _h = set_home(&home);

        let n = migrate_legacy_drafts().unwrap();
        assert_eq!(n, 0, "no legacy dir → 0 files migrated");

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn migrate_moves_bundle_and_legacy_files() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = make_temp_home("moves_files");
        let _h = set_home(&home);

        let legacy = home.join(".mdpro").join("drafts");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(
            legacy.join("doc1.draft.json"),
            r#"{"content":"hello","title":"D1","originalPath":null,"lastModified":"2024-01-01T00:00:00Z","recovered":false}"#,
        ).unwrap();
        fs::write(legacy.join("doc2.draft.md"), "legacy content").unwrap();
        fs::write(
            legacy.join("doc2.meta.json"),
            r#"{"title":"D2","originalPath":null,"lastModified":"2024-01-01T00:00:00Z","recovered":false}"#,
        ).unwrap();

        let n = migrate_legacy_drafts().unwrap();
        assert_eq!(n, 3, "3 files should be migrated");

        let tgt = target_dir();
        assert!(
            tgt.join("doc1.draft.json").exists(),
            "bundle at new location"
        );
        assert!(
            tgt.join("doc2.draft.md").exists(),
            "legacy draft at new location"
        );
        assert!(
            tgt.join("doc2.meta.json").exists(),
            "legacy meta at new location"
        );

        assert!(
            !legacy.join("doc1.draft.json").exists(),
            "old bundle removed"
        );
        assert!(!legacy.join("doc2.draft.md").exists(), "old draft removed");
        assert!(!legacy.join("doc2.meta.json").exists(), "old meta removed");

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn migrate_does_not_overwrite_destination() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = make_temp_home("no_overwrite");
        let _h = set_home(&home);

        let legacy = home.join(".mdpro").join("drafts");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(
            legacy.join("doc1.draft.json"),
            r#"{"content":"OLD","title":"Old","originalPath":null,"lastModified":"2024-01-01T00:00:00Z","recovered":false}"#,
        ).unwrap();

        // Pre-place a newer file at destination.
        let tgt = target_dir();
        fs::create_dir_all(&tgt).unwrap();
        fs::write(
            tgt.join("doc1.draft.json"),
            r#"{"content":"NEW","title":"New","originalPath":null,"lastModified":"2024-06-01T00:00:00Z","recovered":false}"#,
        ).unwrap();

        let n = migrate_legacy_drafts().unwrap();
        assert_eq!(n, 0, "existing destination file must not be overwritten");

        let content = fs::read_to_string(tgt.join("doc1.draft.json")).unwrap();
        assert!(
            content.contains("NEW"),
            "destination content must be preserved"
        );

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn migrate_ignores_non_draft_files() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = make_temp_home("ignores_non_draft");
        let _h = set_home(&home);

        let legacy = home.join(".mdpro").join("drafts");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("random.txt"), "unrelated").unwrap();
        fs::write(
            legacy.join("doc1.draft.json"),
            r#"{"content":"hi","title":"D1","originalPath":null,"lastModified":"2024-01-01T00:00:00Z","recovered":false}"#,
        ).unwrap();

        let n = migrate_legacy_drafts().unwrap();
        assert_eq!(n, 1, "only draft files should be migrated");
        assert!(
            legacy.join("random.txt").exists(),
            "non-draft file left in place"
        );

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn migrate_skips_subdirectories() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = make_temp_home("skips_subdirs");
        let _h = set_home(&home);

        let legacy = home.join(".mdpro").join("drafts");
        fs::create_dir_all(&legacy).unwrap();
        // Create a subdirectory whose name ends with .draft.json to test file_type check.
        let subdir = legacy.join("subdir.draft.json");
        fs::create_dir_all(&subdir).unwrap();
        fs::write(
            legacy.join("real.draft.json"),
            r#"{"content":"c","title":"t","originalPath":null,"lastModified":"2024-01-01T00:00:00Z","recovered":false}"#,
        ).unwrap();

        let n = migrate_legacy_drafts().unwrap();
        assert_eq!(n, 1, "subdirectory must not be counted as a migrated file");
        assert!(subdir.exists(), "subdirectory must not be moved/deleted");

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn migrate_is_idempotent_after_full_migration() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = make_temp_home("idempotent");
        let _h = set_home(&home);

        let legacy = home.join(".mdpro").join("drafts");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(
            legacy.join("doc1.draft.json"),
            r#"{"content":"c","title":"t","originalPath":null,"lastModified":"2024-01-01T00:00:00Z","recovered":false}"#,
        ).unwrap();

        // First run migrates the file.
        let n1 = migrate_legacy_drafts().unwrap();
        assert_eq!(n1, 1);

        // Second run: legacy dir is gone (or empty), returns 0.
        let n2 = migrate_legacy_drafts().unwrap();
        assert_eq!(n2, 0, "second migration must be a no-op");

        let _ = fs::remove_dir_all(&home);
    }
}
