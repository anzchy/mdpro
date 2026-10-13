//! D173-WI-4 (plan r2 §5 and §2): the second-holder reconcile's lock
//! discipline, as a source tripwire in the style of d173_wi1_k. The
//! reconcile copies the prior baseline entry and reads the stored one
//! outside every lock: never under the holders map H, never holding the
//! transition lock T. Pure source text, so ungated.
use std::fs;
use std::path::Path;

/// `d173_wi4_k` (lock tripwire, plan r2 §5 and §2): the reconcile runs
/// outside every lock. Its prior-entry copy and its stored-entry read are
/// never made under H (no `with_map(` argument touches the baselines), it
/// never takes T, and `confirm_hold` runs it only after dropping T.
/// Reads every non-test holders source at run time, so a new
/// `file_watcher_holders_*.rs` or `file_watcher_baseline_peek.rs` is covered.
#[test]
fn d173_wi4_k_reconcile_takes_no_lock() {
    use super::super::kinds_fixture::code_lines;
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/services");
    let mut srcs = Vec::new();
    for entry in fs::read_dir(&dir).expect("services dir") {
        let name = entry
            .expect("entry")
            .file_name()
            .to_string_lossy()
            .into_owned();
        let holders =
            name.starts_with("file_watcher_holders") || name == "file_watcher_baseline_peek.rs";
        if holders && !name.ends_with("_tests.rs") && !name.contains("fixture") {
            let src = fs::read_to_string(dir.join(&name)).expect("read source");
            let cut = src.find("\n#[cfg(test)]").unwrap_or(src.len());
            srcs.push((name, code_lines(&src[..cut]).collect::<Vec<_>>().join("\n")));
        }
    }
    let all: String = srcs
        .iter()
        .map(|(_, s)| s.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let reconcile = fn_body(&all, "fn reconcile");
    assert!(
        reconcile.is_some(),
        "a `fn reconcile…` in the holders sources runs the second-holder reconcile (plan r2 §5)"
    );
    let reconcile = reconcile.unwrap_or_default();
    for banned in [
        "transition(",
        "TransitionGuard",
        ".lock(",
        "canonicalize(",
        "fs::",
    ] {
        assert!(
            !reconcile.contains(banned),
            "the reconcile runs outside every lock and does no I/O of its own (`{banned}`):\n{reconcile}"
        );
    }

    let mut rest = all.as_str();
    while let Some(at) = rest.find("with_map(") {
        let tail = &rest[at..];
        let end = tail.find(");").unwrap_or(tail.len());
        let arg = &tail[..end];
        for banned in [
            "baselines",
            "entry_of",
            "baseline_of",
            "snapshot(",
            "notices",
            "emit_",
        ] {
            assert!(!arg.contains(banned), "`{banned}` under H: {arg}");
        }
        rest = &tail["with_map(".len()..];
    }

    let confirm = fn_body(&all, "fn confirm_hold(").expect("confirm_hold");
    let call = confirm.find("reconcile");
    assert!(
        call.is_some(),
        "confirm_hold runs the reconcile (plan r2 §5):\n{confirm}"
    );
    let dropped = confirm.find("drop(t)");
    assert!(
        dropped.is_some_and(|d| Some(d) < call),
        "confirm_hold drops T before the reconcile:\n{confirm}"
    );
}

/// The text of the first fn whose header contains `anchor`, to the next
/// line that closes at its indent.
fn fn_body(src: &str, anchor: &str) -> Option<String> {
    let start = src.find(anchor)?;
    let line_start = src[..start].rfind('\n').map_or(0, |i| i + 1);
    let indent = src[line_start..start].len() - src[line_start..start].trim_start().len();
    let close = format!("\n{}}}", " ".repeat(indent));
    let rest = &src[line_start..];
    let end = rest.find(&close).map_or(rest.len(), |i| i + close.len());
    Some(rest[..end].to_string())
}
