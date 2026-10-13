//! D190-WI-5 (audit W5): an accepted launch argument is opened under its
//! plain spelling, never the `\\?\` verbatim form Windows' `canonicalize`
//! returns.
//!
//! Seam: `accepted_path_string` is the last step of `classify`, after the
//! filesystem checks, taking the canonical path. A Windows verbatim path
//! cannot be produced by `canonicalize` on macOS, so these tests inject the
//! canonical path directly. Both the first-process launch and the
//! single-instance route reach it through `filter_launch_args`.

use super::test_fixtures::{canon, cleanup, standard_dir};
use super::{accepted_path_string, single_instance_args, DropReason};
use std::path::Path;

#[test]
fn verbatim_disk_canonical_is_accepted_as_plain_path() {
    assert_eq!(
        accepted_path_string(Path::new(r"\\?\C:\Users\jack\mdpro-audit\a.md")),
        Ok(r"C:\Users\jack\mdpro-audit\a.md".to_string())
    );
}

#[test]
fn verbatim_unc_canonical_is_accepted_as_plain_unc_path() {
    assert_eq!(
        accepted_path_string(Path::new(r"\\?\UNC\nas\docs\notes\a.md")),
        Ok(r"\\nas\docs\notes\a.md".to_string())
    );
}

#[test]
fn verbatim_canonical_with_reserved_name_keeps_its_verbatim_form() {
    let p = r"\\?\C:\docs\con.md";
    assert_eq!(accepted_path_string(Path::new(p)), Ok(p.to_string()));
}

#[test]
fn unix_canonical_is_accepted_unchanged() {
    assert_eq!(
        accepted_path_string(Path::new("/Users/jack/notes/a.md")),
        Ok("/Users/jack/notes/a.md".to_string())
    );
}

#[cfg(unix)]
#[test]
fn non_utf8_canonical_still_drops_as_non_utf8() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let p = Path::new(OsStr::from_bytes(b"/tmp/\xff.md"));
    assert_eq!(accepted_path_string(p), Err(DropReason::NonUtf8));
}

/// The real route on this platform: a forwarded absolute argument still
/// comes back as its canonical spelling (the simplifier is the identity on
/// a Unix path).
#[test]
fn single_instance_route_returns_canonical_path_on_unix() {
    let dir = standard_dir("verbatim_route");
    let arg = dir.join("notes.md").to_str().expect("utf-8").to_string();
    let filter = single_instance_args(vec!["mdpro".to_string(), arg], "");
    assert_eq!(filter.paths, vec![canon(&dir, "notes.md")]);
    cleanup(&dir);
}
