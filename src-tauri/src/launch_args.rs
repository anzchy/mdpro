//! Launch-argument filter with an explicit base directory (D33).
//!
//! Purpose: turn the raw arguments a process was started with into the
//! markdown files mdpro should open, resolving relative arguments against a
//! caller-supplied base directory, and count every argument that was dropped
//! by the reason it was dropped.
//!
//! Also hosts `single_instance_args` (the single-instance plugin's forwarded
//! args + cwd) and re-exports the count-only log payload from
//! `launch_args_log.rs`.
//!
//! @coordinates-with launch.rs (`filter_launch_paths` delegates here),
//! launch_args_log.rs (child: `LaunchSource`, `args_filtered_log_*`),
//! main.rs (first-process and single-instance call sites),
//! services/path_plain.rs (`simplify_verbatim` on every accepted path)
//!
//! Key decisions:
//! - **The base is explicit.** A second process forwarded by the
//!   single-instance plugin has its own cwd, not ours, so the caller passes
//!   it in. `None` keeps the legacy behaviour (the OS resolves relative
//!   arguments against *this* process's cwd); `Some(base)` never falls back
//!   to the process cwd: a relative argument with an empty or relative base
//!   drops as `relative_without_cwd` rather than opening the wrong file.
//! - **Absolute arguments ignore the base entirely**, so an unusable base can
//!   never cost an absolute path.
//! - **A leading `-` is a flag unless the *resolved* path is an existing
//!   file.** With no usable base there is nothing to resolve against, so it is
//!   a flag, which files a relative `-x.md` from a cwd-less second process as
//!   a flag (accepted as vanishingly rare).
//! - **One argument, one bucket.** Every argument is either accepted or
//!   counted under exactly one [`DropReason`], checked in a fixed order:
//!   flag, relative-without-cwd, unresolved, not-regular-file, not-markdown,
//!   non-UTF-8. Order and duplicates are preserved; no state crosses
//!   arguments.
//! - **Canonicalized output, in its plain spelling.** Accepted paths resolve
//!   `..` and symlinks, and the extension check runs on the canonical target.
//!   On Windows `canonicalize` returns the `\\?\C:\…` verbatim form; the
//!   accepted string drops that prefix whenever the plain `C:\…` spelling
//!   names the same file (`services/path_plain.rs`, D190-WI-5), so tab titles,
//!   drafts and MCP never see it. A canonical path that is not UTF-8 is
//!   dropped rather than lossily coerced.

use crate::services::path_plain::simplify_verbatim;
use std::path::{Path, PathBuf};

/// Why one launch argument was not opened. Closed set; see [`DropReason::ALL`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropReason {
    Flag,
    RelativeWithoutCwd,
    Unresolved,
    NotRegularFile,
    NotMarkdown,
    NonUtf8,
}

impl DropReason {
    /// Every reason, once each.
    pub const ALL: [DropReason; 6] = [
        DropReason::Flag,
        DropReason::RelativeWithoutCwd,
        DropReason::Unresolved,
        DropReason::NotRegularFile,
        DropReason::NotMarkdown,
        DropReason::NonUtf8,
    ];
}

/// Per-reason drop counts.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct DropCounts {
    pub flag: usize,
    pub relative_without_cwd: usize,
    pub unresolved: usize,
    pub not_regular_file: usize,
    pub not_markdown: usize,
    pub non_utf8: usize,
}

impl DropCounts {
    /// Sum of every counter.
    pub fn total(&self) -> usize {
        self.flag
            + self.relative_without_cwd
            + self.unresolved
            + self.not_regular_file
            + self.not_markdown
            + self.non_utf8
    }

    /// Count one argument dropped for `reason`.
    pub fn record(&mut self, reason: DropReason) {
        let counter = match reason {
            DropReason::Flag => &mut self.flag,
            DropReason::RelativeWithoutCwd => &mut self.relative_without_cwd,
            DropReason::Unresolved => &mut self.unresolved,
            DropReason::NotRegularFile => &mut self.not_regular_file,
            DropReason::NotMarkdown => &mut self.not_markdown,
            DropReason::NonUtf8 => &mut self.non_utf8,
        };
        *counter += 1;
    }
}

/// Accepted paths in argument order, plus what was dropped.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LaunchFilter {
    pub paths: Vec<String>,
    pub dropped: DropCounts,
}

/// True for a markdown extension (case-insensitive).
fn is_markdown_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

/// Where a relative argument should be looked up, before any filesystem check.
/// `None` means there is no usable base (empty or relative `Some`).
fn resolve(arg: &str, base: Option<&Path>) -> Option<PathBuf> {
    let path = Path::new(arg);
    if path.is_absolute() {
        return Some(path.to_path_buf());
    }
    match base {
        None => Some(path.to_path_buf()),
        Some(dir) => dir.is_absolute().then(|| dir.join(path)),
    }
}

/// Classify one argument: its canonical path, or the reason it was dropped.
fn classify(arg: &str, base: Option<&Path>) -> Result<String, DropReason> {
    let resolved = resolve(arg, base);
    let names_file = resolved.as_deref().is_some_and(Path::is_file);
    if arg.starts_with('-') && !names_file {
        return Err(DropReason::Flag);
    }
    let path = resolved.ok_or(DropReason::RelativeWithoutCwd)?;
    let canonical = path.canonicalize().map_err(|_| DropReason::Unresolved)?;
    if !canonical.is_file() {
        return Err(DropReason::NotRegularFile);
    }
    if !is_markdown_ext(&canonical) {
        return Err(DropReason::NotMarkdown);
    }
    accepted_path_string(&canonical)
}

/// The string an accepted argument is opened under, from its canonical path:
/// its plain spelling (a Windows `\\?\` verbatim prefix removed when that
/// names the same file, D190-WI-5), or [`DropReason::NonUtf8`] when the path
/// is not UTF-8.
fn accepted_path_string(canonical: &Path) -> Result<String, DropReason> {
    canonical
        .to_str()
        .map(simplify_verbatim)
        .ok_or(DropReason::NonUtf8)
}

/// Filter raw launch arguments against an optional base directory.
///
/// `base = None` resolves relative arguments against this process's cwd (the
/// first-process launch). `Some(dir)` joins them onto `dir` when `dir` is
/// absolute and drops them as [`DropReason::RelativeWithoutCwd`] when it is
/// empty or relative. `paths.len() + dropped.total() == args.len()` always.
pub fn filter_launch_args<I>(args: I, base: Option<&Path>) -> LaunchFilter
where
    I: IntoIterator<Item = String>,
{
    let mut filter = LaunchFilter::default();
    for arg in args {
        match classify(&arg, base) {
            Ok(path) => filter.paths.push(path),
            Err(reason) => filter.dropped.record(reason),
        }
    }
    filter
}

/// Filter the arguments the single-instance plugin forwarded from a second
/// process, resolving relative ones against *that* process's cwd.
///
/// Pinned plugin contract (tauri-plugin-single-instance 2.4.4, macOS):
/// - `args` is the second process's `std::env::args()`, so `args[0]` is its
///   executable. It is skipped, never classified or counted.
/// - `cwd` is `current_dir().unwrap_or_default().to_str().unwrap_or_default()`,
///   so it may be `""`. It is always passed as `Some(cwd)`, never `None`: an
///   empty cwd drops relative arguments as `relative_without_cwd` instead of
///   resolving them against this process's cwd. Absolute arguments are
///   unaffected.
///
/// Re-check both points when the plugin is bumped.
pub fn single_instance_args(args: Vec<String>, cwd: &str) -> LaunchFilter {
    filter_launch_args(args.into_iter().skip(1), Some(Path::new(cwd)))
}

#[path = "launch_args_log.rs"]
mod args_log;
pub use args_log::{args_filtered_log_entry, args_filtered_log_level, LaunchSource};

#[cfg(test)]
#[path = "launch_args_test_fixtures.rs"]
mod test_fixtures;

#[cfg(test)]
#[path = "launch_args_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "launch_args_verbatim_tests.rs"]
mod verbatim_tests;

#[cfg(test)]
#[path = "launch_args_law_tests.rs"]
mod law_tests;

#[cfg(test)]
#[path = "launch_args_log_tests.rs"]
mod log_tests;

#[cfg(test)]
#[path = "launch_args_log_payload_tests.rs"]
mod log_payload_tests;
