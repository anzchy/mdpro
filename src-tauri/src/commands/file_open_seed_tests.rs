//! D86 WI-3 (matrix: seed law, torn open, error mapping, one read, `/dev/zero`):
//! `open_file_from_path_seeded` reads the file once, decodes those bytes and
//! returns the baseline entry that describes them. macOS only, like the other
//! consumers of `FileWatcher::for_tests()`. Real files, nothing mocked.
use super::file::{open_file_from_path, open_file_from_path_seeded, FileError, MAX_FILE_SIZE};
use super::file_save_fixture::{canon, ev, Dir, CONTENT};
use crate::services::encoding::encode_bytes;
use crate::services::file_watcher::seed::kit;
use crate::services::file_watcher::{FileWatcher, WatchOutcome};
use std::fs;
use std::path::Path;
use std::time::Duration;

const CAP: u64 = kit::HASH_CAP_BYTES;

#[derive(Clone, Copy, Debug)]
enum Enc {
    Utf8,
    Utf8Bom,
    Le,
    Be,
    LeBare,
}

const ENCS: [Enc; 5] = [Enc::Utf8, Enc::Utf8Bom, Enc::Le, Enc::Be, Enc::LeBare];
const ENDINGS: [&str; 3] = ["\n", "\r\n", "\r"];
const BODIES: [&str; 3] = ["", "x", "# T\nline two é 中\n"];

fn encode(enc: Enc, text: &str) -> Vec<u8> {
    match enc {
        Enc::Utf8 => text.as_bytes().to_vec(),
        Enc::Utf8Bom => [&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat(),
        Enc::Le => encode_bytes(text, "UTF-16LE").expect("encode LE"),
        Enc::Be => encode_bytes(text, "UTF-16BE").expect("encode BE"),
        Enc::LeBare => encode_bytes(text, "UTF-16LE").expect("encode LE")[2..].to_vec(),
    }
}

/// Rows where the raw bytes and the decoded, LF-normalised text must differ,
/// so clause (2) can tell a raw-byte hash from a content hash.
fn must_differ(enc: Enc, text: &str) -> bool {
    match enc {
        Enc::Le | Enc::Be => true,
        Enc::LeBare => text.len() > 1,
        Enc::Utf8 | Enc::Utf8Bom => text.contains('\r'),
    }
}

fn s(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

/// Clauses (1)-(5) of the seed law for one file.
fn check_row(label: &str, p: &Path, hint: Option<&str>, differ: bool, symlink: bool) {
    let raw = fs::read(p).expect("raw bytes");
    let n0 = kit::read_once_calls();
    let got = open_file_from_path_seeded(&s(p), hint.map(str::to_string));
    let n1 = kit::read_once_calls();
    assert!(got.is_ok(), "{label}: {:?}", got.as_ref().err());
    assert_eq!(n1.wrapping_sub(n0), 1, "{label}: (4) one read_once");
    let (r, seed) = got.expect("checked");
    assert_eq!(seed, kit::snapshot(p), "{label}: (1) seed == snapshot");
    assert_eq!(seed.hash, kit::h(&raw), "{label}: (2) hash of the raw bytes");
    if differ {
        let content = kit::h(r.document.content.as_bytes());
        assert_ne!(kit::h(&raw), content, "{label}: precondition, raw != text");
    }
    let w = open_file_from_path(&s(p), hint.map(str::to_string))
        .unwrap_or_else(|e| panic!("{label}: wrapper {e:?}"));
    assert_eq!(r.document.content, w.document.content, "{label}: (3)");
    assert_eq!(r.document.encoding, w.document.encoding, "{label}: (3)");
    assert_eq!(r.document.line_ending, w.document.line_ending, "{label}: (3)");
    if symlink {
        assert!(seed.hash.is_some(), "{label}: (5) a file symlink is stable");
    }
}

#[test]
fn seed_equals_snapshot_on_a_quiescent_file_for_every_encoding() {
    let d = Dir::new("seed_law");
    let mut rows = 0;
    for (i, enc) in ENCS.iter().enumerate() {
        for (j, ending) in ENDINGS.iter().enumerate() {
            for (k, body) in BODIES.iter().enumerate() {
                let text = body.replace('\n', ending);
                let p = d.file(&format!("r{i}{j}{k}.md"), &encode(*enc, &text));
                let label = format!("{enc:?} x {ending:?} x {body:?}");
                check_row(&label, &p, None, must_differ(*enc, &text), false);
                rows += 1;
            }
        }
    }
    let hinted = d.file("hint.md", &encode(Enc::LeBare, BODIES[2]));
    check_row("hint UTF-16LE", &hinted, Some("UTF-16LE"), true, false);
    d.file("a.md", b"hello world");
    let l = kit::file_symlink(d.path(), "l.md", "a.md");
    check_row("file symlink", &l, None, false, true);
    assert_eq!(rows + 2, 47, "the enumerated domain");
}

/// The torn open: a write lands after the read and before the second fstat.
/// Leg 1 keeps the path stat; leg 2 changes it.
#[test]
fn seed_stat_before_read_fails_open_on_torn_open() {
    for leg in [1, 2] {
        let d = Dir::new("torn");
        let p = d.file("a.md", b"AAAA");
        let pre = kit::stat_pair(&p).expect("pre stat");
        let p2 = p.clone();
        let hook = move || {
            if leg == 1 {
                kit::rewrite_keep_stat(&p2, b"BBBB");
            } else {
                fs::write(&p2, b"BBBBBB").expect("write BBBBBB");
                kit::set_mtime(&p2, pre.0 + Duration::from_secs(5));
            }
        };
        let got = kit::with_read_hook(hook, || open_file_from_path_seeded(&s(&p), None));
        assert!(got.is_ok(), "leg {leg}: {:?}", got.as_ref().err());
        let (r, seed) = got.expect("checked");
        if leg == 2 {
            assert_ne!(kit::stat_pair(&p), Some(pre), "leg 2: precondition");
        }
        assert_eq!(seed.hash, None, "leg {leg}: torn read fails open");
        assert_eq!(seed.stat, Some(pre), "leg {leg}: the pre-read fstat");
        assert_eq!(r.document.content, "AAAA", "leg {leg}: the bytes read");
        let fw = FileWatcher::for_tests();
        fw.watch_seeded(&p, seed);
        let (emitted, outcome) = fw.route_for_tests(&ev(CONTENT, &canon(&p)));
        let payload = serde_json::to_value(&emitted).expect("payload");
        assert_eq!(payload, kit::modified(&canon(&p)), "leg {leg}");
        assert_eq!(outcome, WatchOutcome::EmittedModified, "leg {leg}");
    }
}

fn err_of<T>(r: Result<T, FileError>) -> serde_json::Value {
    match r {
        Ok(_) => serde_json::json!("Ok"),
        Err(e) => serde_json::to_value(e).expect("serialize FileError"),
    }
}

fn json(e: FileError) -> serde_json::Value {
    serde_json::to_value(e).expect("serialize FileError")
}

#[test]
fn seeded_open_preserves_error_mapping() {
    let d = Dir::new("errmap");
    let missing = d.path().join("nope.md");
    let want = json(FileError::FileNotFound { path: s(&missing) });
    assert_eq!(err_of(open_file_from_path_seeded(&s(&missing), None)), want, "(a)");
    assert_eq!(err_of(open_file_from_path(&s(&missing), None)), want, "(a) wrapper");

    let locked = d.file("locked.md", b"secret");
    kit::chmod_000_unreadable(&locked);
    let want = json(FileError::PermissionDenied { path: s(&locked) });
    assert_eq!(err_of(open_file_from_path_seeded(&s(&locked), None)), want, "(b)");
    assert_eq!(err_of(open_file_from_path(&s(&locked), None)), want, "(b) wrapper");

    let gone = d.file("gone.md", b"x");
    fs::remove_file(&gone).expect("remove");
    let kind = kit::read_once(&gone).err().map(|e| e.kind());
    assert_eq!(kind, Some(std::io::ErrorKind::NotFound), "(c')");

    let big = d.path().join("big.md");
    kit::sparse(&big, CAP + 1);
    let want = json(FileError::FileTooLarge {
        path: s(&big),
        size: CAP + 1,
    });
    assert_eq!(err_of(open_file_from_path_seeded(&s(&big), None)), want, "(d)");
    assert_eq!(err_of(open_file_from_path(&s(&big), None)), want, "(d) wrapper");
}

#[test]
fn open_seeded_runs_read_once_exactly_once() {
    let d = Dir::new("one_read");
    for (name, bytes) in [("a.md", &b"hello"[..]), ("e.md", &b""[..])] {
        let p = d.file(name, bytes);
        let n0 = kit::read_once_calls();
        let got = open_file_from_path_seeded(&s(&p), None);
        let n1 = kit::read_once_calls();
        assert!(got.is_ok(), "{name}: {:?}", got.as_ref().err());
        assert_eq!(n1.wrapping_sub(n0), 1, "{name}: one read_once");
    }
}

/// A char device behind a `.md` symlink: metadata size 0 passes the
/// pre-check, the capped read returns `CAP + 1` bytes. The seeded call is
/// asserted first: today's unbounded `std::fs::read` would never return.
#[test]
fn open_seeded_over_cap_device_is_file_too_large() {
    use std::os::unix::fs::FileTypeExt;
    let d = Dir::new("devzero");
    assert!(Path::new("/dev/zero").exists(), "precondition: /dev/zero");
    let z = d.path().join("z.md");
    std::os::unix::fs::symlink("/dev/zero", &z).expect("symlink");
    let meta = fs::metadata(&z).expect("stat z");
    assert_eq!(meta.len(), 0, "precondition: metadata size passes");
    assert!(meta.file_type().is_char_device(), "precondition: char device");
    assert_eq!(MAX_FILE_SIZE, CAP, "precondition: one cap");
    let want = json(FileError::FileTooLarge {
        path: s(&z),
        size: CAP + 1,
    });
    assert_eq!(err_of(open_file_from_path_seeded(&s(&z), None)), want, "seeded");
    assert_eq!(err_of(open_file_from_path(&s(&z), None)), want, "wrapper");
}
