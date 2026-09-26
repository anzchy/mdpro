//! Shared fixtures for the `launch_args` test files (D33).
//!
//! Every fixture lives under `temp_dir()/mdpro_launch_args_test/{label}_{pid}`
//! and is returned canonicalized. The process cwd is never mutated.

use super::{filter_launch_args, DropCounts, LaunchFilter};
use std::path::{Component, Path, PathBuf};

/// Fresh, empty, canonicalized per-test directory.
pub(super) fn fixture_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join("mdpro_launch_args_test")
        .join(format!("{label}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create fixture dir");
    dir.canonicalize().expect("canonicalize fixture dir")
}

/// A fixture dir holding the standard population.
pub(super) fn standard_dir(label: &str) -> PathBuf {
    let dir = fixture_dir(label);
    for file in ["notes.md", "-dash.md", "data.txt", "-data.txt"] {
        std::fs::write(dir.join(file), b"x").expect("write fixture file");
    }
    for sub in ["dir.md", "plain_dir", "sub"] {
        std::fs::create_dir_all(dir.join(sub)).expect("create fixture subdir");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        for (link, target) in [
            ("link.md", "notes.md"),
            ("link_to_txt.md", "data.txt"),
            ("link.txt", "notes.md"),
            ("dangling.md", "missing.md"),
        ] {
            symlink(target, dir.join(link)).expect("create fixture symlink");
        }
    }
    dir
}

pub(super) fn cleanup(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

/// `dir/name` as a string, not canonicalized beyond `dir` itself.
pub(super) fn abs(dir: &Path, name: &str) -> String {
    dir.join(name)
        .to_str()
        .expect("utf-8 fixture path")
        .to_string()
}

/// Canonical form of `dir/name` as a string.
pub(super) fn canon(dir: &Path, name: &str) -> String {
    dir.join(name)
        .canonicalize()
        .expect("canonicalize fixture entry")
        .to_str()
        .expect("utf-8 fixture path")
        .to_string()
}

/// A `../`-prefixed path that reaches `target` from the process cwd.
pub(super) fn rel_from_cwd(target: &Path) -> String {
    let cwd = std::env::current_dir().expect("process cwd");
    let cwd = cwd.canonicalize().unwrap_or(cwd);
    let depth = cwd
        .components()
        .filter(|c| matches!(c, Component::Normal(_)))
        .count();
    let tail = target.to_str().expect("utf-8 fixture path");
    format!("{}{}", "../".repeat(depth), tail.trim_start_matches('/'))
}

/// The four-base grid: `None`, `Some(dir)`, `Some("")`, `Some("rel/dir")`.
pub(super) fn bases(dir: &Path) -> Vec<Option<PathBuf>> {
    vec![
        None,
        Some(dir.to_path_buf()),
        Some(PathBuf::from("")),
        Some(PathBuf::from("rel/dir")),
    ]
}

/// The eight-element argument pool.
pub(super) fn pool(dir: &Path) -> Vec<String> {
    vec![
        abs(dir, "notes.md"),
        "notes.md".to_string(),
        "--devtools".to_string(),
        "ghost.md".to_string(),
        abs(dir, "dir.md"),
        abs(dir, "data.txt"),
        "-dash.md".to_string(),
        "-data.txt".to_string(),
    ]
}

/// Every sequence of length `0..=max_len` over `items`.
pub(super) fn sequences(items: &[String], max_len: usize) -> Vec<Vec<String>> {
    let mut all = vec![Vec::new()];
    let mut frontier: Vec<Vec<String>> = vec![Vec::new()];
    for _ in 0..max_len {
        let mut next = Vec::new();
        for seq in &frontier {
            for item in items {
                let mut grown = seq.clone();
                grown.push(item.clone());
                next.push(grown);
            }
        }
        all.extend(next.iter().cloned());
        frontier = next;
    }
    all
}

/// `filter_launch_args` over string slices.
pub(super) fn run(args: &[&str], base: Option<&Path>) -> LaunchFilter {
    filter_launch_args(args.iter().map(|a| a.to_string()), base)
}

pub(super) fn lf(paths: Vec<String>, dropped: DropCounts) -> LaunchFilter {
    LaunchFilter { paths, dropped }
}

use super::DropReason;

/// The counter for `r`; exhaustive, no `_` arm (D33 WI-2).
pub(super) fn slot(r: DropReason, c: &mut DropCounts) -> &mut usize {
    match r {
        DropReason::Flag => &mut c.flag,
        DropReason::RelativeWithoutCwd => &mut c.relative_without_cwd,
        DropReason::Unresolved => &mut c.unresolved,
        DropReason::NotRegularFile => &mut c.not_regular_file,
        DropReason::NotMarkdown => &mut c.not_markdown,
        DropReason::NonUtf8 => &mut c.non_utf8,
    }
}

/// Every `DropCounts` with each field in `{0,1,2}` (729 values).
pub(super) fn count_grid() -> Vec<DropCounts> {
    let mut all = vec![DropCounts::default()];
    for r in DropReason::ALL {
        let mut next = Vec::new();
        for c in &all {
            for n in 0..3 {
                let mut grown = c.clone();
                *slot(r, &mut grown) = n;
                next.push(grown);
            }
        }
        all = next;
    }
    all
}
