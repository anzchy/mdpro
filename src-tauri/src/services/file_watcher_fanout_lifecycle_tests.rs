//! D185-WI-2: the fan-out across a file's lifecycle. A rename gives every
//! held spelling the real reported `newPath`, a remove gives every recipient
//! `deleted`, and a released spelling is no longer a recipient (the leaf map
//! no longer has it). Mounted from file_watcher_fanout_tests.rs, whose
//! fixtures it shares.
use super::super::super::baseline::fixture::ev;
use super::super::super::holders::ReleaseOutcome;
use super::super::super::FileWatcher;
use super::{
    acquire, assert_copies, deliver, external_modify, paths, s, sorted, spellings, W1, W2, W3,
};
use crate::commands::file_save_fixture::Dir;
use notify::event::{ModifyKind, RemoveKind, RenameMode};
use notify::{Event, EventKind};

#[test]
fn d185_wi2_f_remove_and_rename_reach_every_recipient() {
    let d = Dir::new("d185_wi2_f");
    let f = spellings(&d);
    let (fw, _notices) = FileWatcher::for_tests_noticed();
    acquire(&fw, W1, &f.canonical);
    acquire(&fw, W2, &f.alias);

    let to = f.canonical.with_file_name("moved.md");
    std::fs::rename(&f.canonical, &to).expect("rename");
    let rename = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
        .add_path(f.canonical.clone())
        .add_path(to.clone());
    let sent = deliver(&fw, rename);
    assert_eq!(
        paths(&sent),
        sorted(vec![s(&f.canonical), s(&f.alias)]),
        "the gone file's group still finds both spellings"
    );
    assert_copies(&sent, "renamed", Some(&s(&to)));

    std::fs::rename(&to, &f.canonical).expect("rename back");
    std::fs::remove_file(&f.canonical).expect("delete");
    let removed = ev(EventKind::Remove(RemoveKind::File), &[&f.canonical]);
    let sent = deliver(&fw, removed);
    assert_eq!(
        paths(&sent),
        sorted(vec![s(&f.canonical), s(&f.alias)]),
        "every recipient is told of the delete"
    );
    assert_copies(&sent, "deleted", None);
}

/// A released spelling is not a recipient: the leaf map no longer has it.
/// The alias still held keeps the case non-vacuous.
#[test]
fn d185_wi2_i_released_spelling_is_not_a_recipient() {
    let d = Dir::new("d185_wi2_i");
    let f = spellings(&d);
    let (fw, _notices) = FileWatcher::for_tests_noticed();
    acquire(&fw, W2, &f.alias);
    let gen = acquire(&fw, W3, &f.raw);
    assert_eq!(
        fw.release_hold(W3, &f.raw, gen),
        ReleaseOutcome::UnclaimedRaw
    );

    let sent = deliver(&fw, external_modify(&f));
    assert_eq!(
        paths(&sent),
        sorted(vec![s(&f.canonical), s(&f.alias)]),
        "the alias and the event path; never the released {:?}",
        f.raw
    );
}
