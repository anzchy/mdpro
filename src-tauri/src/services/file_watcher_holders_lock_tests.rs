//! D173-WI-1 (k): the holders' lock discipline, as a source tripwire in the
//! style of d106_f. Delegator rulings: no I/O under the leaf holders lock H;
//! the transition lock T is held through a teardown's unwatch; the notify
//! callback never takes T.

/// k (lock discipline, source tripwire in the style of d106_f):
/// - H (`map`) is taken in exactly one place, `fn with_map(`, and every
///   `with_map(` call is one expression with no I/O and no other lock;
/// - `impl HoldMap` is pure: no lock, no canonicalize, no fs, no notify;
/// - every function in the holders files that calls notify `unwatch` or
///   `drop_notify_path` takes a `TransitionGuard`, so lock T is held
///   through the teardown's unwatch (delegator ruling);
/// - the notify callback path never names T.
#[test]
fn d173_wi1_k_holders_lock_is_a_leaf() {
    use super::super::kinds_fixture::{code_lines, fn_slice};
    const HOLDERS: &str = include_str!("file_watcher_holders.rs");
    const TEARDOWN: &str = include_str!("file_watcher_holders_teardown.rs");
    const WATCHER: &str = include_str!("file_watcher.rs");
    let prod = |src: &'static str| -> String {
        let cut = src.find("\n#[cfg(test)]").unwrap_or(src.len());
        code_lines(&src[..cut]).collect::<Vec<_>>().join("\n")
    };
    let (holders, teardown) = (prod(HOLDERS), prod(TEARDOWN));
    let both = format!("{holders}\n{teardown}");
    let io = [
        ".lock(",
        "canonicalize(",
        "fs::",
        "File::",
        "metadata(",
        "baseline_key(",
        "snapshot(",
        ".watch(",
        "unwatch(",
        "apply_watch(",
        "drop_notify_path(",
        "logger::",
        "log_event(",
        "baselines",
    ];

    assert_eq!(
        both.matches("map.lock(").count(),
        1,
        "H is locked in exactly one place:\n{both}"
    );
    let locker = fn_slice(&both, "fn with_map(");
    assert!(locker.contains("map.lock("), "with_map takes H:\n{locker}");

    let mut calls = 0;
    let mut rest = both.as_str();
    while let Some(at) = rest.find("with_map(") {
        let tail = &rest[at + "with_map(".len()..];
        let (mut depth, mut end) = (1usize, tail.len());
        for (i, c) in tail.char_indices() {
            match c {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = i;
                        break;
                    }
                }
                _ => {}
            }
        }
        let arg = &tail[..end];
        if !rest[..at].ends_with("fn ") {
            calls += 1;
            assert!(!arg.contains(';'), "one expression under H: {arg}");
            for token in io {
                assert!(!arg.contains(token), "`{token}` under H: {arg}");
            }
        }
        rest = &tail[end..];
    }
    assert!(calls > 0, "non-vacuity: H is used through with_map");

    let pure = fn_slice(&both, "impl HoldMap");
    assert!(pure.lines().count() > 3, "non-vacuity: impl HoldMap:\n{pure}");
    let pure_start = both.find("impl HoldMap").unwrap();
    let pure_block = &both[pure_start..];
    let pure_block = &pure_block[..pure_block.find("\n}").unwrap_or(pure_block.len())];
    for token in io {
        assert!(!pure_block.contains(token), "impl HoldMap does `{token}`");
    }

    let mut teardowns = 0;
    for body in fn_chunks(&both) {
        let header = &body[..body.find('{').unwrap_or(body.len())];
        let unwatches = body.contains(".unwatch(") || body.contains("drop_notify_path(");
        if unwatches && !header.contains("fn drop_notify_path(") {
            teardowns += 1;
            assert!(
                header.contains("TransitionGuard"),
                "T must be held through this unwatch:\n{body}"
            );
        }
    }
    assert!(teardowns > 0, "non-vacuity: a teardown calls unwatch");

    for anchor in ["pub fn new(", "fn handle_event(", "fn observe_event("] {
        let body = fn_slice(WATCHER, anchor);
        assert!(
            !body.contains("transitions") && !body.contains("TransitionGuard"),
            "the notify callback path names T in {anchor}:\n{body}"
        );
    }
}

/// `src` cut into one chunk per function: each chunk starts at a line whose
/// trimmed text begins a `fn` item and runs to the next such line.
fn fn_chunks(src: &str) -> Vec<String> {
    let starts_fn = |l: &str| {
        let t = l.trim_start();
        ["fn ", "pub fn ", "pub(crate) fn ", "pub(super) fn "]
            .iter()
            .any(|p| t.starts_with(p))
    };
    let mut out: Vec<String> = Vec::new();
    for line in src.lines() {
        if starts_fn(line) {
            out.push(String::new());
        }
        if let Some(cur) = out.last_mut() {
            cur.push_str(line);
            cur.push('\n');
        }
    }
    out
}
