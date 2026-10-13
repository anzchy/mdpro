//! D190-WI-2 (ADR-0093) companion fix 1: the self-write gate matches a
//! save's mark and a watcher event by one normalised key, and counts
//! overlapping marks. On Windows the save marks `canonicalize`'s
//! `\\?\C:\…` while notify reports the spelling the file was watched under
//! (`C:\…` from the Open dialog), so an exact-path set never matched; and a
//! plain set let the first of two overlapping saves of one path unmark the
//! second. Real paths, real symlinks, the real process-global gate; unique
//! paths keep parallel tests apart.
use super::super::baseline::fixture::TempDir;
use super::super::kinds_fixture::{unique_path, WriteMark};
use super::{gate_key, is_self_write, mark_write_end, mark_write_start, strip_verbatim};
use std::fs;
use std::path::{Path, PathBuf};

/// `D/real/doc.md` and its spelling through the symlinked `D/alias`.
#[cfg(unix)]
fn two_spellings(d: &TempDir, name: &str, create: bool) -> (PathBuf, PathBuf) {
    let real = d.path().join("real");
    let alias = d.path().join("alias");
    if !real.exists() {
        fs::create_dir(&real).expect("real dir");
        std::os::unix::fs::symlink(&real, &alias).expect("alias -> real");
    }
    if create {
        fs::write(real.join(name), b"x").expect("write");
    }
    let canonical = fs::canonicalize(&real).expect("canonical dir").join(name);
    let spelled = alias.join(name);
    assert_ne!(canonical, spelled, "precondition: two spellings");
    (canonical, spelled)
}

/// G1 (S2 over prefix classes): a verbatim disk path loses `\\?\`, a
/// verbatim UNC path becomes `\\server\share\…`; a plain disk path, a plain
/// UNC path, a device path, a volume GUID path and a Unix path are kept.
#[test]
fn g1_strip_verbatim_removes_only_the_disk_and_unc_verbatim_prefixes() {
    let cases: [(&str, &str); 8] = [
        (r"\\?\C:\x\work1.md", r"C:\x\work1.md"),
        (r"\\?\d:\a b\c.md", r"d:\a b\c.md"),
        (r"\\?\UNC\srv\share\a.md", r"\\srv\share\a.md"),
        (r"C:\x\work1.md", r"C:\x\work1.md"),
        (r"\\srv\share\a.md", r"\\srv\share\a.md"),
        (r"\\.\C:\x.md", r"\\.\C:\x.md"),
        (r"\\?\Volume{0b1c}\x.md", r"\\?\Volume{0b1c}\x.md"),
        ("/private/var/a.md", "/private/var/a.md"),
    ];
    for (input, want) in cases {
        assert_eq!(strip_verbatim(Path::new(input)), Path::new(want), "{input}");
    }
}

/// G2 (S5, idempotence): normalising twice is normalising once.
#[test]
fn g2_strip_verbatim_is_idempotent() {
    for input in [r"\\?\C:\x.md", r"\\?\UNC\s\h\a.md", r"C:\x.md", "/a/b.md"] {
        let once = strip_verbatim(Path::new(input));
        assert_eq!(strip_verbatim(&once), once, "{input}");
    }
}

/// G3: a mark under one spelling suppresses an event under the other, both
/// ways round (a symlinked directory is the Unix shape of `C:\…` against
/// `\\?\C:\…`), and unmarking under either spelling clears it.
#[cfg(unix)]
#[test]
fn g3_a_mark_matches_an_event_under_another_spelling() {
    let d = TempDir::new("g3");
    let (canonical, spelled) = two_spellings(&d, "doc.md", true);
    for (mark, event) in [(&canonical, &spelled), (&spelled, &canonical)] {
        let m = WriteMark::new(mark);
        assert!(is_self_write(event), "mark {mark:?}, event {event:?}");
        drop(m);
        assert!(!is_self_write(event), "cleared: {event:?}");
    }
    assert_eq!(gate_key(&canonical), gate_key(&spelled));
}

/// G4: a save to a new file marks a path that does not exist yet; the event
/// for the created file, under the other spelling, still matches.
#[cfg(unix)]
#[test]
fn g4_a_mark_on_a_new_file_matches_its_creation_under_another_spelling() {
    let d = TempDir::new("g4");
    let (_, spelled) = two_spellings(&d, "seed.md", true);
    let (canonical, _) = two_spellings(&d, "new.md", false);
    assert!(spelled.exists() && !canonical.exists(), "precondition");
    let _m = WriteMark::new(&canonical);
    let created = d.path().join("alias").join("new.md");
    fs::write(&created, b"new").expect("create");
    assert!(is_self_write(&created), "created under the alias");
}

/// G5: two overlapping saves of one path; the first to finish must not
/// unmark the second.
#[test]
fn g5_overlapping_marks_are_counted() {
    let p = unique_path("g5");
    mark_write_start(&p);
    mark_write_start(&p);
    mark_write_end(&p);
    assert!(is_self_write(&p), "one save still in flight");
    mark_write_end(&p);
    assert!(!is_self_write(&p), "both finished");
}

/// G6 (S4, exhaustive over every mark/end sequence up to length 6): after
/// each step, `is_self_write` is true exactly when more marks than ends have
/// landed, an end with nothing to end doing nothing.
#[test]
fn g6_the_gate_is_a_counter_that_never_goes_below_zero() {
    for len in 0..=6u32 {
        for bits in 0..(1u32 << len) {
            let p = unique_path("g6");
            let mut model = 0u32;
            for i in 0..len {
                if bits & (1 << i) != 0 {
                    mark_write_start(&p);
                    model += 1;
                } else {
                    mark_write_end(&p);
                    model = model.saturating_sub(1);
                }
                assert_eq!(
                    is_self_write(&p),
                    model > 0,
                    "len {len} bits {bits:b} step {i}"
                );
            }
            while model > 0 {
                mark_write_end(&p);
                model -= 1;
            }
            assert!(!is_self_write(&p), "drained");
        }
    }
}
