//! Test cases for `services::file_watcher_log::classify_event_kind` (D32 WI-1,
//! c1-c6).
//!
//! Wired from `file_watcher_log.rs` with `#[cfg(test)] #[path = ...] mod tests;`
//! so the specification lives apart from the implementation it constrains.

use super::{classify_event_kind, WatchKindClass, ALL_DETAILS, ALL_KINDS};
use crate::services::file_watcher::kinds_fixture::{
    all_event_kinds, code_lines, is_bare_binding_arm,
};
use notify::event::{
    AccessKind, AccessMode, CreateKind, DataChange, MetadataKind, ModifyKind, RemoveKind,
    RenameMode,
};
use notify::EventKind;
use std::collections::{HashMap, HashSet};

const DOMAIN: usize = 41;

fn class(kind: &'static str, detail: &'static str) -> WatchKindClass {
    WatchKindClass { kind, detail }
}

/// Written by hand, not derived from `all_event_kinds()`.
fn table() -> Vec<(EventKind, &'static str, &'static str)> {
    use AccessKind as A;
    use AccessMode as M;
    use EventKind::{Access, Create, Modify, Remove};
    use ModifyKind::{Data, Metadata, Name};
    vec![
        (EventKind::Any, "any", "none"),
        (EventKind::Other, "other", "none"),
        (Access(A::Any), "access", "any"),
        (Access(A::Read), "access", "read"),
        (Access(A::Other), "access", "other"),
        (Access(A::Open(M::Any)), "access", "open_any"),
        (Access(A::Open(M::Execute)), "access", "open_execute"),
        (Access(A::Open(M::Read)), "access", "open_read"),
        (Access(A::Open(M::Write)), "access", "open_write"),
        (Access(A::Open(M::Other)), "access", "open_other"),
        (Access(A::Close(M::Any)), "access", "close_any"),
        (Access(A::Close(M::Execute)), "access", "close_execute"),
        (Access(A::Close(M::Read)), "access", "close_read"),
        (Access(A::Close(M::Write)), "access", "close_write"),
        (Access(A::Close(M::Other)), "access", "close_other"),
        (Create(CreateKind::Any), "create", "any"),
        (Create(CreateKind::File), "create", "file"),
        (Create(CreateKind::Folder), "create", "folder"),
        (Create(CreateKind::Other), "create", "other"),
        (Modify(ModifyKind::Any), "modify_any", "none"),
        (Modify(ModifyKind::Other), "modify_other", "none"),
        (Modify(Data(DataChange::Any)), "modify_data", "any"),
        (Modify(Data(DataChange::Size)), "modify_data", "size"),
        (Modify(Data(DataChange::Content)), "modify_data", "content"),
        (Modify(Data(DataChange::Other)), "modify_data", "other"),
        (
            Modify(Metadata(MetadataKind::Any)),
            "modify_metadata",
            "any",
        ),
        (
            Modify(Metadata(MetadataKind::AccessTime)),
            "modify_metadata",
            "access_time",
        ),
        (
            Modify(Metadata(MetadataKind::WriteTime)),
            "modify_metadata",
            "write_time",
        ),
        (
            Modify(Metadata(MetadataKind::Permissions)),
            "modify_metadata",
            "permissions",
        ),
        (
            Modify(Metadata(MetadataKind::Ownership)),
            "modify_metadata",
            "ownership",
        ),
        (
            Modify(Metadata(MetadataKind::Extended)),
            "modify_metadata",
            "extended",
        ),
        (
            Modify(Metadata(MetadataKind::Other)),
            "modify_metadata",
            "other",
        ),
        (Modify(Name(RenameMode::Any)), "modify_name", "any"),
        (Modify(Name(RenameMode::To)), "modify_name", "to"),
        (Modify(Name(RenameMode::From)), "modify_name", "from"),
        (Modify(Name(RenameMode::Both)), "modify_name", "both"),
        (Modify(Name(RenameMode::Other)), "modify_name", "other"),
        (Remove(RemoveKind::Any), "remove", "any"),
        (Remove(RemoveKind::File), "remove", "file"),
        (Remove(RemoveKind::Folder), "remove", "folder"),
        (Remove(RemoveKind::Other), "remove", "other"),
    ]
}

#[test]
fn c1_exhaustive_classification_table() {
    let table = table();
    assert_eq!(table.len(), DOMAIN);
    let table_kinds: HashSet<EventKind> = table.iter().map(|(k, _, _)| *k).collect();
    let fixture_kinds: HashSet<EventKind> = all_event_kinds().into_iter().collect();
    assert_eq!(
        table_kinds, fixture_kinds,
        "table must cover the fixture domain"
    );
    for (kind, want_kind, want_detail) in &table {
        assert_eq!(
            classify_event_kind(kind),
            class(want_kind, want_detail),
            "row {kind:?}"
        );
    }
}

#[test]
fn c2_classification_is_injective() {
    let mut seen: HashMap<WatchKindClass, Vec<EventKind>> = HashMap::new();
    for kind in all_event_kinds() {
        seen.entry(classify_event_kind(&kind))
            .or_default()
            .push(kind);
    }
    let collisions: Vec<_> = seen.values().filter(|v| v.len() > 1).collect();
    assert_eq!(seen.len(), DOMAIN, "colliding kinds: {collisions:?}");
}

fn is_snake_word(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c == '_')
}

#[test]
fn c3_vocabulary_is_closed() {
    let produced: Vec<WatchKindClass> = all_event_kinds().iter().map(classify_event_kind).collect();
    let kinds: HashSet<&str> = produced.iter().map(|c| c.kind).collect();
    let details: HashSet<&str> = produced.iter().map(|c| c.detail).collect();
    let declared_kinds: HashSet<&str> = ALL_KINDS.iter().copied().collect();
    let declared_details: HashSet<&str> = ALL_DETAILS.iter().copied().collect();

    assert_eq!(
        ALL_KINDS.len(),
        declared_kinds.len(),
        "ALL_KINDS has duplicates"
    );
    assert_eq!(
        ALL_DETAILS.len(),
        declared_details.len(),
        "ALL_DETAILS has duplicates"
    );
    let expected_kinds: HashSet<&str> = [
        "any",
        "access",
        "create",
        "modify_any",
        "modify_data",
        "modify_metadata",
        "modify_name",
        "modify_other",
        "remove",
        "other",
    ]
    .into_iter()
    .collect();
    assert_eq!(declared_kinds, expected_kinds);
    assert_eq!(kinds, declared_kinds, "produced kinds vs ALL_KINDS");
    assert_eq!(details, declared_details, "produced details vs ALL_DETAILS");
    for s in ALL_KINDS.iter().chain(ALL_DETAILS) {
        assert!(is_snake_word(s), "not ^[a-z_]+$: {s:?}");
    }
}

#[test]
fn c4_d32_named_cases() {
    use EventKind::Modify;
    use ModifyKind::{Data, Metadata};
    assert_eq!(
        classify_event_kind(&Modify(Metadata(MetadataKind::Extended))),
        class("modify_metadata", "extended")
    );
    assert_eq!(
        classify_event_kind(&Modify(Metadata(MetadataKind::Any))),
        class("modify_metadata", "any")
    );
    assert_eq!(
        classify_event_kind(&Modify(Data(DataChange::Content))),
        class("modify_data", "content")
    );
}

#[test]
fn c5_fixture_enumerator_is_complete() {
    let kinds = all_event_kinds();
    assert_eq!(kinds.len(), DOMAIN);
    assert_eq!(kinds.iter().collect::<HashSet<_>>().len(), DOMAIN);
    let count = |pred: fn(&EventKind) -> bool| kinds.iter().filter(|k| pred(k)).count();
    assert_eq!(count(|k| matches!(k, EventKind::Access(_))), 13);
    assert_eq!(count(|k| matches!(k, EventKind::Create(_))), 4);
    assert_eq!(count(|k| matches!(k, EventKind::Modify(_))), 18);
    assert_eq!(
        count(|k| matches!(k, EventKind::Modify(ModifyKind::Data(_)))),
        4
    );
    assert_eq!(
        count(|k| matches!(k, EventKind::Modify(ModifyKind::Metadata(_)))),
        7
    );
    assert_eq!(
        count(|k| matches!(k, EventKind::Modify(ModifyKind::Name(_)))),
        5
    );
    assert_eq!(
        count(|k| matches!(k, EventKind::Modify(ModifyKind::Any))),
        1
    );
    assert_eq!(
        count(|k| matches!(k, EventKind::Modify(ModifyKind::Other))),
        1
    );
    assert_eq!(count(|k| matches!(k, EventKind::Remove(_))), 4);
    assert_eq!(count(|k| matches!(k, EventKind::Any)), 1);
    assert_eq!(count(|k| matches!(k, EventKind::Other)), 1);
}

#[test]
fn c6_no_wildcard_or_bare_binding_arm_in_source() {
    for yes in ["_ =>", "    _=> {}", "other => {}", "  kind => x,", "k2=>"] {
        assert!(is_bare_binding_arm(yes), "predicate should match {yes:?}");
    }
    for no in [
        "EventKind::Any =>",
        "Some(x) =>",
        "None =>",
        "let a = b;",
        "x >= 2",
        "Ok(()) =>",
    ] {
        assert!(
            !is_bare_binding_arm(no),
            "predicate should not match {no:?}"
        );
    }
    assert_eq!(
        code_lines("// other =>\n    /// k =>")
            .filter(|l| is_bare_binding_arm(l))
            .count(),
        0,
        "a comment line must not count as an arm"
    );
    assert_eq!(code_lines("// other =>\nx >= 2").count(), 1);

    let src = include_str!("file_watcher_log.rs");
    let offenders: Vec<&str> = code_lines(src).filter(|l| is_bare_binding_arm(l)).collect();
    assert!(offenders.is_empty(), "catch-all arms: {offenders:?}");
    assert!(
        src.contains("non_exhaustive"),
        "doc comment must state notify 6.1.1 enums are not #[non_exhaustive]"
    );
}
