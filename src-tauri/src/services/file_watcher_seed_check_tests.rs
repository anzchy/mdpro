//! D111-WI-2: after `watch_seeded` registers a path, it checks the disk
//! against the seed it was given (never the stored baseline) and returns
//! the answer; it never stores. Real files and a real notify watcher
//! (`FileWatcher::for_tests()`); concurrent store operations land inside the
//! check's read through the read hook. Covers Codex interleavings 4 and 9.
//! macOS only, like the other register suites.
use super::{read_for_open, seed_for_written, Entry, SeedCheck};
use crate::services::file_watcher::baseline::next_ticket;
use crate::services::file_watcher::seed::kit::{
    chmod_000_unreadable, h, rewrite_keep_stat, sparse, with_read_hook, TempDir, HASH_CAP_BYTES,
};
use crate::services::file_watcher::FileWatcher;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// The open's seed of `p` as it is now.
fn seed_of(p: &Path) -> Entry {
    read_for_open(p).expect("read for open").1
}

/// Register `seed` for `p` on a fresh watcher; the check's answer and the
/// baseline left behind.
fn register(p: &Path, seed: Entry) -> (SeedCheck, Option<Entry>) {
    let fw = FileWatcher::for_tests();
    let got = fw.watch_seeded(p, seed);
    (got, fw.baseline_of(p))
}

/// A quiet file: unchanged, and the baseline is the seed.
#[test]
fn d111_wi2_a_a_quiet_file_is_unchanged_and_keeps_the_seed() {
    let d = TempDir::new("d111s_a");
    let p = d.file("a.md", b"AAAA");
    let seed = seed_of(&p);
    assert_eq!(register(&p, seed), (SeedCheck::Unchanged, Some(seed)));
}

/// Interleaving 4: a write between the read and the register, which no
/// notify event reports, is reported to the caller. Leg 1 keeps the stat,
/// so only the hash tells; leg 2 changes it. The baseline stays the seed:
/// the check never advances it to the bytes it read.
#[test]
fn d111_wi2_b_a_write_between_read_and_register_is_changed() {
    let d = TempDir::new("d111s_b");
    let p = d.file("a.md", b"AAAA");
    let seed = seed_of(&p);
    rewrite_keep_stat(&p, b"BBBB");
    assert_eq!(
        register(&p, seed),
        (SeedCheck::Changed, Some(seed)),
        "same stat"
    );

    let q = d.file("b.md", b"AAAA");
    let seed = seed_of(&q);
    fs::write(&q, b"a longer external body").expect("rewrite");
    assert_eq!(
        register(&q, seed),
        (SeedCheck::Changed, Some(seed)),
        "new stat"
    );
}

/// A seed that cannot prove anything fails open without a read: no hash
/// (a torn or over-cap open read) or no stat (a Save As target another
/// writer resized, D129).
#[test]
fn d111_wi2_c_a_seed_without_hash_or_stat_is_failopen_seed() {
    let d = TempDir::new("d111s_c");
    let p = d.file("a.md", b"AAAA");
    let full = seed_of(&p);
    for seed in [Entry { hash: None, ..full }, Entry { stat: None, ..full }] {
        assert_eq!(register(&p, seed), (SeedCheck::FailOpenSeed, Some(seed)));
    }
}

/// A failed read fails open: the file is gone, or unreadable.
#[test]
fn d111_wi2_d_a_failed_read_is_failopen_read() {
    let d = TempDir::new("d111s_d");
    let p = d.file("gone.md", b"AAAA");
    let seed = seed_of(&p);
    fs::remove_file(&p).expect("remove");
    assert_eq!(register(&p, seed).0, SeedCheck::FailOpenRead, "missing");

    let q = d.file("locked.md", b"AAAA");
    let seed = seed_of(&q);
    chmod_000_unreadable(&q);
    assert_eq!(register(&q, seed), (SeedCheck::FailOpenRead, Some(seed)));
}

/// A write landing during the check's own read makes it torn: fail open,
/// whatever the bytes.
#[test]
fn d111_wi2_e_a_torn_check_read_is_failopen_unstable() {
    let d = TempDir::new("d111s_e");
    let p = d.file("a.md", b"AAAA");
    let seed = seed_of(&p);
    let q = p.clone();
    let got = with_read_hook(
        move || fs::write(&q, b"AAAAAA").unwrap(),
        || register(&p, seed),
    );
    assert_eq!(got, (SeedCheck::FailOpenUnstable, Some(seed)));
}

/// A file grown past the cap fails open; the cap follows a large seed's
/// size, so a quiet Save As seed past `HASH_CAP_BYTES` reads back unchanged.
#[test]
fn d111_wi2_f_the_cap_is_the_larger_of_the_hash_cap_and_the_seed() {
    let d = TempDir::new("d111s_f");
    let p = d.file("a.md", b"AAAA");
    let seed = seed_of(&p);
    sparse(&p, HASH_CAP_BYTES + 8);
    assert_eq!(register(&p, seed), (SeedCheck::FailOpenCap, Some(seed)));

    let big = vec![b'x'; (HASH_CAP_BYTES + 8) as usize];
    let q = d.file("big.md", &big);
    let seed = seed_for_written(&q, &big);
    assert_eq!(register(&q, seed), (SeedCheck::Unchanged, Some(seed)));
}

/// `p` written after its seed was taken, with a shared watcher.
fn changed_after_seed(d: &TempDir, name: &str) -> (PathBuf, Entry, Arc<FileWatcher>) {
    let p = d.file(name, b"AAAA");
    let seed = seed_of(&p);
    fs::write(&p, b"BBBBBB").expect("external write");
    (p, seed, Arc::new(FileWatcher::for_tests()))
}

/// Interleaving 9a: a notify refresh lands during the check. The check
/// still compares with the seed (changed), and it does not restore the seed
/// over the refresh.
#[test]
fn d111_wi2_g_a_refresh_during_the_check_survives_it() {
    let d = TempDir::new("d111s_g");
    let (p, seed, fw) = changed_after_seed(&d, "a.md");
    let (fw2, q) = (Arc::clone(&fw), p.clone());
    let got = with_read_hook(
        move || fw2.baselines().refresh_if_present(&q),
        || fw.watch_seeded(&p, seed),
    );
    assert_eq!(got, SeedCheck::Changed);
    let now = fw.baseline_of(&p).expect("an entry");
    assert_eq!(now.hash, h(b"BBBBBB"), "the refresh's entry, not the seed");
}

/// Interleaving 9b: a newer register lands during the check. Its entry
/// stays, neither the seed nor the bytes the check read.
#[test]
fn d111_wi2_h_a_newer_register_during_the_check_wins() {
    let d = TempDir::new("d111s_h");
    let (p, seed, fw) = changed_after_seed(&d, "a.md");
    let newer = Entry {
        stat: None,
        hash: Some(42),
    };
    let (fw2, q) = (Arc::clone(&fw), p.clone());
    let got = with_read_hook(
        move || {
            fw2.baselines().register_seeded(&q, newer, next_ticket());
        },
        || fw.watch_seeded(&p, seed),
    );
    assert_eq!(got, SeedCheck::Changed);
    assert_eq!(fw.baseline_of(&p), Some(newer));
}

/// Interleaving 9c: an unwatch lands during the check. The check does not
/// revive the entry, and the caller still gets its answer.
#[test]
fn d111_wi2_i_an_unwatch_during_the_check_is_not_revived() {
    let d = TempDir::new("d111s_i");
    let (p, seed, fw) = changed_after_seed(&d, "a.md");
    let (fw2, q) = (Arc::clone(&fw), p.clone());
    let got = with_read_hook(move || fw2.unwatch(&q), || fw.watch_seeded(&p, seed));
    assert_eq!(got, SeedCheck::Changed);
    assert_eq!(fw.baseline_of(&p), None);
    assert!(fw.watched().is_empty());
}

/// A register the ticket rule skips still checks: the caller's read is just
/// as stale (Codex: report a changed seed to that caller regardless).
#[test]
fn d111_wi2_j_a_stale_skipped_register_still_reports() {
    let d = TempDir::new("d111s_j");
    let (p, seed, _) = changed_after_seed(&d, "a.md");
    let store = super::super::baseline::BaselineStore::default();
    let old = next_ticket();
    let other = Entry {
        stat: None,
        hash: Some(1),
    };
    store.register_seeded(&p, other, next_ticket());
    assert_eq!(
        store.register_seeded(&p, seed, old),
        super::super::baseline::StoreOutcome::StaleSkipped,
        "precondition"
    );
    assert_eq!(super::check_seed(&p, &seed), SeedCheck::Changed);
}

/// The closed vocabulary: one exact string per variant, and only
/// `Unchanged` reports no change.
#[test]
fn d111_wi2_k_seed_check_strings_and_changed() {
    let want = [
        (SeedCheck::Unchanged, "unchanged", false),
        (SeedCheck::Changed, "changed", true),
        (SeedCheck::FailOpenSeed, "failopen_seed", true),
        (SeedCheck::FailOpenCap, "failopen_cap", true),
        (SeedCheck::FailOpenUnstable, "failopen_unstable", true),
        (SeedCheck::FailOpenRead, "failopen_read", true),
    ];
    assert_eq!(want.len(), SeedCheck::ALL.len());
    for (v, s, changed) in want {
        assert!(SeedCheck::ALL.contains(&v), "{v:?}");
        assert_eq!((v.as_str(), v.changed()), (s, changed), "{v:?}");
    }
}

// The register line carries the check (D111-WI-2): still exactly one
// `file.watch.register` line per `watch_seeded`, now with `seedCheck`,
// read back from the real log under a temp `$HOME`.
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use serde_json::{json, Value};

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft/draft_test_home.rs"]
mod draft_test_home;

/// Restores the process-global logger settings on drop.
struct Restore(crate::models::LogSettings);
impl Drop for Restore {
    fn drop(&mut self) {
        crate::services::logger::set_log_settings(self.0.clone());
    }
}

/// Every `file.watch.register` line for `p` in `log`.
fn register_lines(log: &Path, p: &Path) -> Vec<Value> {
    let text = fs::read_to_string(log).unwrap_or_default();
    let raw = json!(p.to_string_lossy());
    text.lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["event"] == json!("file.watch.register") && v["context"]["path"] == raw)
        .collect()
}

#[test]
fn d111_wi2_l_the_one_register_line_carries_seed_check() {
    let home = draft_test_home::TempHome::new(&format!("d111_wi2_l_{}", std::process::id()));
    let _restore = Restore(crate::services::logger::get_log_settings());
    crate::services::logger::set_log_settings(crate::models::LogSettings {
        enabled: true,
        level: crate::models::LogLevel::Info,
    });
    let log = home.path().join(".mdpro").join("mdpro.log");
    let _ = fs::remove_file(&log);
    let d = TempDir::new("d111s_l");

    let quiet = d.file("quiet.md", b"AAAA");
    let (written, seed_w, _) = changed_after_seed(&d, "written.md");
    let torn = d.file("torn.md", b"AAAA");
    let seed_t = Entry {
        hash: None,
        ..seed_of(&torn)
    };
    for (p, seed, want) in [
        (&quiet, seed_of(&quiet), "unchanged"),
        (&written, seed_w, "changed"),
        (&torn, seed_t, "failopen_seed"),
    ] {
        register(p, seed);
        let lines = register_lines(&log, p);
        assert_eq!(lines.len(), 1, "{want}: one line: {lines:?}");
        let ctx = &lines[0]["context"];
        assert_eq!(ctx["seedCheck"], json!(want), "{want}: {ctx}");
        assert!(
            ctx.get("baseline").is_some(),
            "{want}: baseline kept: {ctx}"
        );
    }
}
