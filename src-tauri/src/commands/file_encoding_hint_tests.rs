//! D52 (ADR-0057 decisions 2 and 3): a hinted UTF-16 retry from the encoding
//! dialog is refused unless the decode is plausible.
//!
//! **Law**: `decode_opened(p, _, bytes, Some(UTF-16LE|UTF-16BE))` returns
//! `Ok` with `document.encoding == hint` iff the bytes carry the hint's own
//! BOM, or the BOM-less decode is plausible UTF-16 text (it has at least one
//! ASCII-range code unit U+0001..=U+007F and no U+0000). Otherwise it returns
//! `Err(EncodingError { path == p, detected })`, the same shape the dialog
//! already parses, and no `Document` exists to be marked UTF-16 or saved.
//!
//! The GBK samples are hand-encoded (GB2312 code points, the subset GBK and
//! GB18030 share). Every one of them is even-length and decodes under both
//! hints through `String::from_utf16` without error, so before D52 each one
//! opened "successfully" as CJK/Hangul mojibake; nothing but the plausibility
//! rule refuses them now.
//!
//! Nothing is mocked: `decode_opened` takes bytes, and the disk case uses a
//! real temp file through `open_file_from_path`.

use super::*;
use std::path::{Path, PathBuf};

const P: &str = "/tmp/d52-fixture.md";

/// GBK "中文": 中 = D6 D0, 文 = CE C4. Under LE it is U+D0D6 U+C4CE, two
/// Hangul syllables; under BE U+D6D0 U+CEC4, also Hangul.
const GBK_ZHONGWEN: [u8; 4] = [0xD6, 0xD0, 0xCE, 0xC4];

/// GBK "# 标题\n正文\n" (12 bytes):
/// `#`=23 ` `=20 标=B1 EA 题=CC E2 `\n`=0A 正=D5 FD 文=CE C4 `\n`=0A.
/// LE units 2023 EAB1 E2CC D50A CEFD 0AC4, BE units 2320 B1EA CCE2 0AD5 FDCE
/// C40A: no surrogates, so `from_utf16` accepts both, and none is < 0x80
/// because no GBK byte is 0x00.
const GBK_MARKDOWN: [u8; 12] = [
    0x23, 0x20, 0xB1, 0xEA, 0xCC, 0xE2, 0x0A, 0xD5, 0xFD, 0xCE, 0xC4, 0x0A,
];

fn utf16(text: &str, little_endian: bool) -> Vec<u8> {
    text.encode_utf16()
        .flat_map(|u| {
            if little_endian {
                u.to_le_bytes()
            } else {
                u.to_be_bytes()
            }
        })
        .collect()
}

fn open_hinted(bytes: &[u8], hint: &str) -> Result<OpenFileResult, FileError> {
    decode_opened(P, PathBuf::from(P), bytes.to_vec(), Some(hint.to_string()))
}

/// The refusal is the existing `EncodingError` shape, for this path, and no
/// document came out of it.
fn assert_refused(bytes: &[u8], hint: &str, label: &str) {
    match open_hinted(bytes, hint) {
        Err(FileError::EncodingError { path, detected }) => {
            assert_eq!(path, P, "{label} under {hint}: path");
            assert!(!detected.is_empty(), "{label} under {hint}: detected");
        }
        Err(other) => panic!("{label} under {hint}: wrong error {other:?}"),
        Ok(opened) => panic!(
            "{label} under {hint}: opened as {} with content {:?}",
            opened.document.encoding, opened.document.content
        ),
    }
}

#[test]
fn d52_gbk_zhongwen_is_refused_under_both_utf16_hints() {
    for hint in ["UTF-16LE", "UTF-16BE"] {
        assert_refused(&GBK_ZHONGWEN, hint, "GBK 中文");
    }
}

#[test]
fn d52_gbk_markdown_is_refused_under_both_utf16_hints() {
    for hint in ["UTF-16LE", "UTF-16BE"] {
        assert_refused(&GBK_MARKDOWN, hint, "GBK markdown");
    }
}

#[test]
fn d52_hint_case_does_not_bypass_the_check() {
    // decode_bytes upper-cases the encoding; the check must do the same.
    for hint in ["utf-16le", "Utf-16Be"] {
        assert_refused(&GBK_MARKDOWN, hint, "GBK markdown, lower-case hint");
    }
}

#[test]
fn d52_bomless_utf16le_markdown_opens_under_the_le_hint() {
    let bytes = utf16("# Title\nbody", true);
    let opened = open_hinted(&bytes, "UTF-16LE").expect("plausible UTF-16LE opens");
    assert_eq!(opened.document.content, "# Title\nbody");
    assert_eq!(opened.document.encoding, "UTF-16LE");
}

#[test]
fn d52_bomless_utf16be_markdown_opens_under_the_be_hint() {
    let bytes = utf16("# 标题\n正文", false);
    let opened = open_hinted(&bytes, "UTF-16BE").expect("plausible UTF-16BE opens");
    assert_eq!(opened.document.content, "# 标题\n正文");
    assert_eq!(opened.document.encoding, "UTF-16BE");
}

#[test]
fn d52_wrong_endian_utf16_is_refused() {
    // `23 00` read big-endian is U+2300, `0A 00` is U+0A00: no ASCII unit.
    assert_refused(&utf16("# Title\nbody", true), "UTF-16BE", "LE bytes");
    assert_refused(&utf16("# Title\nbody", false), "UTF-16LE", "BE bytes");
}

#[test]
fn d52_a_nul_code_unit_is_refused() {
    // Has ASCII units, but U+0000 never occurs in a text document: it means
    // binary data or a misread, so the retry is refused.
    assert_refused(&utf16("# a\u{0}b\n", true), "UTF-16LE", "NUL unit");
}

#[test]
fn d52_odd_length_is_refused_under_a_utf16_hint() {
    let mut bytes = utf16("# Title\n", true);
    bytes.push(b'x');
    for hint in ["UTF-16LE", "UTF-16BE"] {
        assert_refused(&bytes, hint, "odd length");
    }
}

/// Known limit, named on purpose: a BOM-less UTF-16 file whose text has no
/// ASCII-range character at all (no newline, no space, no `#`) is refused,
/// although it is genuine UTF-16. "中文" in UTF-16LE is `2D 4E 87 65`.
#[test]
fn d52_known_limit_pure_cjk_one_line_bomless_utf16_is_refused() {
    let bytes = [0x2D, 0x4E, 0x87, 0x65];
    assert_eq!(utf16("中文", true), bytes, "fixture is UTF-16LE 中文");
    assert_refused(&bytes, "UTF-16LE", "pure-CJK UTF-16LE");
}

#[test]
fn d52_bom_files_open_as_before_without_a_hint() {
    let mut le = vec![0xFF, 0xFE];
    le.extend(utf16("中文", true));
    let mut be = vec![0xFE, 0xFF];
    be.extend(utf16("中文", false));
    for (bytes, enc) in [(le, "UTF-16LE"), (be, "UTF-16BE")] {
        let opened = decode_opened(P, PathBuf::from(P), bytes.clone(), None)
            .unwrap_or_else(|e| panic!("BOM'd {enc} without a hint: {e:?}"));
        assert_eq!(opened.document.content, "中文");
        assert_eq!(opened.document.encoding, enc);
        // The BOM is the evidence: a matching hint skips the plausibility
        // check, so pure-CJK BOM'd text still opens when hinted.
        let hinted = open_hinted(&bytes, enc)
            .unwrap_or_else(|e| panic!("BOM'd {enc} with its own hint: {e:?}"));
        assert_eq!(hinted.document.content, "中文");
        assert_eq!(hinted.document.encoding, enc);
    }
}

#[test]
fn d52_utf8_and_ascii_hints_are_unchanged() {
    let opened = open_hinted("# 标题\n".as_bytes(), "UTF-8").expect("UTF-8 hint");
    assert_eq!(opened.document.content, "# 标题\n");
    assert_eq!(opened.document.encoding, "UTF-8");
    assert!(matches!(
        open_hinted(&GBK_MARKDOWN, "UTF-8"),
        Err(FileError::EncodingError { .. })
    ));
    assert!(matches!(
        open_hinted(&GBK_MARKDOWN, "ASCII"),
        Err(FileError::EncodingError { .. })
    ));
}

/// A per-test directory, removed on drop.
struct FixtureDir(PathBuf);

impl FixtureDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir()
            .join("mdpro_d52_encoding_hint_tests")
            .join(format!("{label}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create fixture dir");
        FixtureDir(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for FixtureDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn d52_refused_retry_through_the_real_open_leaves_the_file_untouched() {
    let dir = FixtureDir::new("untouched");
    let file = dir.path().join("gbk.md");
    std::fs::write(&file, GBK_MARKDOWN).expect("write fixture");
    let p = file.to_string_lossy().to_string();
    let mtime_before = std::fs::metadata(&file).and_then(|m| m.modified()).ok();

    // First open (no hint): the dialog's trigger.
    assert!(matches!(
        open_file_from_path(&p, None),
        Err(FileError::EncodingError { .. })
    ));
    for hint in ["UTF-16LE", "UTF-16BE"] {
        match open_file_from_path(&p, Some(hint.to_string())) {
            Err(FileError::EncodingError { path, .. }) => assert_eq!(path, p),
            other => panic!(
                "{hint} retry: expected EncodingError, got {:?}",
                other.map(|r| r.document.encoding)
            ),
        }
    }

    assert_eq!(
        std::fs::read(&file).expect("re-read"),
        GBK_MARKDOWN,
        "bytes unchanged"
    );
    assert_eq!(
        std::fs::metadata(&file).and_then(|m| m.modified()).ok(),
        mtime_before,
        "mtime unchanged"
    );
    let entries: Vec<_> = std::fs::read_dir(dir.path())
        .expect("list dir")
        .map(|e| e.expect("entry").file_name())
        .collect();
    assert_eq!(
        entries.len(),
        1,
        "no temp or sibling file written: {entries:?}"
    );
}
