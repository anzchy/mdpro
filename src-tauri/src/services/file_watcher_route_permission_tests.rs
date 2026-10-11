//! D164 (ADR-0080): a permission-only or owner-only change on a watched file
//! whose bytes are unchanged is dropped as unchanged. On macOS FSEvents
//! reports a `chmod` with the change-owner flag, which notify maps to
//! `Metadata(Ownership)`; before ADR-0080 that kind skipped the D32 check
//! and every `chmod 444` / `chmod 644` raised "modified externally". A file
//! made unreadable (`chmod 000`) still emits: the baseline read fails and
//! the check fails open (`ReadFailed`). Real store, real temp files, real
//! `set_permissions`, synthetic events through the real route.
use super::super::baseline::fixture::{chmod, ev, fresh, modified, rewrite_keep_stat, TempDir};
use super::super::baseline::{is_filtered_kind, UnchangedCheck};
use super::super::kinds_fixture::T;
use super::super::{BaselineStore, WatchOutcome};
use super::process_event_checked;
use notify::event::{MetadataKind, ModifyKind};
use notify::EventKind;
use std::path::{Path, PathBuf};

use WatchOutcome::{EmittedModified, IgnoredUnchanged};

const OWNERSHIP: EventKind = EventKind::Modify(ModifyKind::Metadata(MetadataKind::Ownership));
const PERMISSIONS: EventKind = EventKind::Modify(ModifyKind::Metadata(MetadataKind::Permissions));

/// Restores mode 0644 on drop, so a failed assertion still leaves the temp
/// file removable.
struct Restore<'a>(&'a Path);

impl Drop for Restore<'_> {
    fn drop(&mut self) {
        chmod(self.0, 0o644);
    }
}

/// `name` holding `bytes`, registered in a fresh store and unchanged.
fn registered(d: &TempDir, name: &str, bytes: &[u8]) -> (BaselineStore, PathBuf) {
    let p = d.file(name, bytes);
    let store = BaselineStore::default();
    store.register(&p);
    assert!(
        store.is_unchanged(&p),
        "precondition: registered, unchanged"
    );
    (store, p)
}

/// The route's (emitted payload, outcome, check) for one event on `p`.
fn checked(
    kind: EventKind,
    p: &Path,
    store: &BaselineStore,
) -> (serde_json::Value, WatchOutcome, UnchangedCheck) {
    let map = fresh();
    let (em, outcome, check) = process_event_checked(&ev(kind, &[p]), &map, store, T);
    (serde_json::to_value(&em).unwrap(), outcome, check)
}

/// a: the device case. `chmod 444` then an Ownership event, and `chmod 644`
/// back then another, on unchanged bytes: both dropped as unchanged. RED
/// before ADR-0080: `EmittedModified`, `NotChecked`.
#[test]
fn pm_a_chmod_444_and_back_with_an_ownership_event_is_ignored_unchanged() {
    let d = TempDir::new("pm-a");
    let (store, p) = registered(&d, "a.md", b"same bytes");
    let _restore = Restore(&p);
    for mode in [0o444, 0o644] {
        chmod(&p, mode);
        assert_eq!(
            checked(OWNERSHIP, &p, &store),
            (
                serde_json::Value::Null,
                IgnoredUnchanged,
                UnchangedCheck::Unchanged
            ),
            "mode {mode:o}"
        );
    }
}

/// b: the same with `Metadata(Permissions)`. RED before ADR-0080.
#[test]
fn pm_b_chmod_444_with_a_permissions_event_is_ignored_unchanged() {
    let d = TempDir::new("pm-b");
    let (store, p) = registered(&d, "b.md", b"same bytes");
    let _restore = Restore(&p);
    chmod(&p, 0o444);
    assert_eq!(
        checked(PERMISSIONS, &p, &store),
        (
            serde_json::Value::Null,
            IgnoredUnchanged,
            UnchangedCheck::Unchanged
        )
    );
}

/// c (decision (c)): `chmod 000` makes the file unreadable, the baseline
/// read fails, the check fails open, and the event emits `modified` with
/// `ReadFailed`, for both kinds. A root run reads a 000 file anyway, so it
/// skips rather than passing vacuously.
#[test]
fn pm_c_chmod_000_still_emits_with_read_failed() {
    // SAFETY: geteuid has no preconditions and cannot fail.
    if unsafe { libc::geteuid() } == 0 {
        println!("SKIPPED: pm_c: running as root, a mode-000 file stays readable");
        return;
    }
    let d = TempDir::new("pm-c");
    for (i, kind) in [OWNERSHIP, PERMISSIONS].into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("c{i}.md"), b"same bytes");
        let _restore = Restore(&p);
        chmod(&p, 0o000);
        assert!(std::fs::read(&p).is_err(), "precondition: unreadable");
        assert_eq!(
            checked(kind, &p, &store),
            (modified(&p), EmittedModified, UnchangedCheck::ReadFailed),
            "{kind:?}"
        );
    }
}

/// d: other bytes under the same stat, plus an Ownership or Permissions
/// event, still emit `modified`: a real change prompts.
#[test]
fn pm_d_changed_bytes_with_an_ownership_event_still_emit() {
    let d = TempDir::new("pm-d");
    for (i, kind) in [OWNERSHIP, PERMISSIONS].into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("d{i}.md"), b"hello world");
        rewrite_keep_stat(&p, b"hello WORLD");
        assert_eq!(
            checked(kind, &p, &store),
            (modified(&p), EmittedModified, UnchangedCheck::HashDiffers),
            "{kind:?}"
        );
    }
}

/// e (pin): WriteTime, AccessTime and Other stay unfiltered: on unchanged
/// bytes they emit and are never checked.
#[test]
fn pm_e_write_time_access_time_and_other_still_emit_unchecked() {
    let d = TempDir::new("pm-e");
    let kinds = [
        MetadataKind::WriteTime,
        MetadataKind::AccessTime,
        MetadataKind::Other,
    ];
    for (i, m) in kinds.into_iter().enumerate() {
        let (store, p) = registered(&d, &format!("e{i}.md"), b"same bytes");
        let kind = EventKind::Modify(ModifyKind::Metadata(m));
        assert_eq!(
            checked(kind, &p, &store),
            (modified(&p), EmittedModified, UnchangedCheck::NotChecked),
            "{m:?}"
        );
    }
}

/// f: `is_filtered_kind` over every metadata subkind (ADR-0068 decision 1
/// as amended by ADR-0080).
#[test]
fn pm_f_is_filtered_kind_over_every_metadata_subkind() {
    use MetadataKind::*;
    let table = [
        (Any, true),
        (Extended, true),
        (Ownership, true),
        (Permissions, true),
        (WriteTime, false),
        (AccessTime, false),
        (Other, false),
    ];
    for (m, want) in table {
        let kind = EventKind::Modify(ModifyKind::Metadata(m));
        assert_eq!(is_filtered_kind(&kind), want, "{m:?}");
    }
}
