//! D32 WI-5 (matrix L9): source tripwire for the production wiring.
//! `FileWatcher::new` needs an `AppHandle`, which no test can build, so the
//! one property no behavioural test can see (the notify callback and the
//! struct share one `BaselineStore`) is pinned on the source text. The device
//! fixture `tests/manual-fixtures/d32-metadata-reopen.md` is its behavioural
//! check (ADR-0068).
use super::super::kinds_fixture::{code_lines, fn_slice};

const WATCHER_SRC: &str = include_str!("file_watcher.rs");

fn code_of(anchor: &str) -> String {
    code_lines(fn_slice(WATCHER_SRC, anchor))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The name bound by `let <name> = Arc::clone(&baselines);`, if any.
fn clone_binding(src: &str) -> Option<String> {
    src.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("let ")?;
        let (name, rhs) = rest.split_once(" = ")?;
        (rhs.trim() == "Arc::clone(&baselines);").then(|| name.trim().to_string())
    })
}

#[test]
fn l9_production_new_shares_one_store_between_struct_and_callback() {
    let new = code_of("pub fn new(");
    assert_eq!(
        new.matches("Arc::new(BaselineStore").count(),
        1,
        "exactly one store is built in new: {new}"
    );
    let binding = clone_binding(&new)
        .unwrap_or_else(|| panic!("no `let X = Arc::clone(&baselines);` in new: {new}"));
    assert_ne!(binding, "baselines", "{new}");
    let call = new
        .lines()
        .find(|l| l.contains("Ok(event) => handle_event("))
        .unwrap_or_else(|| panic!("the callback calls handle_event: {new}"));
    assert!(
        call.contains(&format!("&{binding})")),
        "the callback passes the shared clone `{binding}`: {call}"
    );
    let init = &new[new.find("Self {").expect("a `Self {` initialiser")..];
    let init = &init[..init.find('}').expect("initialiser closes")];
    assert!(
        init.lines()
            .any(|l| l.trim().trim_end_matches(',') == "baselines"),
        "the struct keeps the same Arc: {init}"
    );

    let accessor = code_of("fn baselines(");
    assert!(accessor.contains("-> &BaselineStore"), "{accessor}");
    assert!(
        accessor.contains("&self.baselines") || accessor.contains("&*self.baselines"),
        "the accessor yields the struct's store: {accessor}"
    );
}
