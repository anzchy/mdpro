//! D86 WI-3 (matrix w14_watch_seeded_row, and g8 for `watch_seeded`):
//! `watch_seeded` has `watch`'s shape. It calls notify through
//! `apply_watch(…, WatchOp::Register)`, draws its ticket inside the block
//! holding the watcher locks, logs after `apply_watch`, and stores the seed
//! after the locks drop. The W14 scan reads only `file_watcher.rs`, so this
//! row reads the sibling that holds `watch_seeded` (plan issue P6).

const SRC: &str = include_str!("file_watcher_seed.rs");

/// Non-comment lines of the fn whose header contains `anchor`, up to the
/// closing brace at the header's indentation.
fn body(anchor: &str) -> Vec<&'static str> {
    let prod = SRC.split("\n#[cfg(test)]").next().unwrap_or(SRC);
    let lines: Vec<&'static str> = prod
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect();
    let start = lines
        .iter()
        .position(|l| l.contains(anchor))
        .unwrap_or_else(|| panic!("`{anchor}` not found"));
    let indent = lines[start].len() - lines[start].trim_start().len();
    let close = format!("{}}}", " ".repeat(indent));
    let end = lines[start..]
        .iter()
        .position(|l| *l == close)
        .expect("fn closes");
    lines[start..=start + end].to_vec()
}

fn position(lines: &[&str], from: usize, what: &str, pred: impl Fn(&str) -> bool) -> usize {
    lines[from..]
        .iter()
        .position(|l| pred(l))
        .map(|i| from + i)
        .unwrap_or_else(|| panic!("{what} not found in {lines:#?}"))
}

/// W14 row: one `apply_watch(` with `WatchOp::Register`, one `log_event(`
/// after it, no direct notify call, and the fixed signature.
#[test]
fn w14_watch_seeded_delegates_to_apply_watch_and_logs() {
    let b = body("fn watch_seeded(");
    let s = b.join("\n");
    assert!(
        s.contains("pub(crate) fn watch_seeded(&self, path: &Path, seed: Entry)"),
        "signature: {s}"
    );
    assert_eq!(s.matches("apply_watch(").count(), 1, "{s}");
    assert!(s.contains("WatchOp::Register"), "{s}");
    assert!(!s.contains("WatchOp::Unregister"), "{s}");
    assert_eq!(s.matches("log_event(").count(), 1, "{s}");
    assert!(
        s.find("log_event(") > s.find("apply_watch("),
        "log after apply_watch: {s}"
    );
    assert!(!s.contains("let _ = watcher."), "Result discarded: {s}");
    assert!(!s.contains(".watch(path"), "direct notify call: {s}");
}

/// g8 row: exactly one `next_ticket(`, between the `watched_paths` lock and
/// the end of the `let … = { … };` block; `register_seeded(` after it.
#[test]
fn g8_watch_seeded_takes_its_ticket_inside_the_watcher_lock_block() {
    let b = body("fn watch_seeded(");
    let tickets = b.iter().filter(|l| l.contains("next_ticket(")).count();
    assert_eq!(tickets, 1, "one ticket: {b:#?}");
    let lock = position(&b, 0, "the list lock", |l| {
        l.contains("self.watched_paths.lock()")
    });
    let close = position(&b, lock, "the block end", |l| l.trim() == "};");
    let ticket = position(&b, 0, "next_ticket(", |l| l.contains("next_ticket("));
    assert!(
        lock <= ticket && ticket < close,
        "ticket under the locks: {b:#?}"
    );
    let call = position(&b, 0, "register_seeded(", |l| {
        l.contains("register_seeded(")
    });
    assert!(call > close, "store after the locks drop: {b:#?}");
    assert!(!b.iter().any(|l| l.contains("register_at(")), "{b:#?}");
}

use super::{baseline_log, BaselineLog as L, Entry, StoreOutcome as O};

/// Fails to compile when `StoreOutcome` gains a variant, so the two tables
/// below are revisited rather than silently missing a row.
#[allow(dead_code)]
fn every_outcome_has_a_row(o: O) {
    match o {
        O::Stored(_) | O::StaleSkipped | O::Removed => {}
    }
}

/// `baseline_log` over every register outcome × `seeded`. The unhashed rows
/// pin the guard order: `FailOpen` is checked before `Seeded`, so a seeded
/// entry with no hash still logs `failopen`.
#[test]
fn baseline_log_maps_every_store_outcome_and_seeded_flag() {
    let stat = Some((std::time::SystemTime::UNIX_EPOCH, 4));
    let hashed = Entry {
        stat,
        hash: Some(7),
    };
    let unhashed = Entry { stat, hash: None };
    let rows = [
        (O::Stored(unhashed), true, L::FailOpen),
        (O::Stored(unhashed), false, L::FailOpen),
        (O::Stored(hashed), true, L::Seeded),
        (O::Stored(hashed), false, L::Snapshot),
        (O::StaleSkipped, true, L::StaleSkipped),
        (O::StaleSkipped, false, L::StaleSkipped),
    ];
    for (stored, seeded, want) in rows {
        assert_eq!(
            baseline_log(stored, seeded),
            want,
            "{stored:?}, seeded={seeded}"
        );
    }
}

/// `Removed`, which a register never yields: a debug assertion in test and
/// debug builds, `StaleSkipped` in release.
#[test]
fn baseline_log_removed_asserts_in_debug_and_is_stale_skipped_in_release() {
    for seeded in [true, false] {
        let got = std::panic::catch_unwind(|| baseline_log(O::Removed, seeded));
        if cfg!(debug_assertions) {
            assert!(got.is_err(), "seeded={seeded}: debug_assert must fire");
        } else {
            assert_eq!(got.ok(), Some(L::StaleSkipped), "seeded={seeded}");
        }
    }
}
