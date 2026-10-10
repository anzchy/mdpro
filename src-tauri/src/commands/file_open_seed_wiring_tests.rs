//! D86 WI-3 (matrix: open_seeded_decodes_the_bytes_it_seeded,
//! open_file_wiring_uses_the_seed, over_cap_read_maps_to_file_too_large).
//! Source tripwires for interleavings the after-read seam cannot reach, plus
//! the pure `over_cap_error` rows. Pure source text, so ungated.
//!
//! The seeded open lives in `file_open_seed.rs` (file.rs is far past 300
//! lines). The decode stays in file.rs, in `decode_opened`, which takes the
//! bytes as an argument; (iii) follows that argument (the matrix's allowed
//! "helper that takes the bytes" form). The direct form is accepted too.
use super::file::open_seed::over_cap_error;
use super::file::FileError;
use crate::services::file_watcher::kinds_fixture::{code_lines, fn_slice};

const FILE_SRC: &str = include_str!("file.rs");
const SEED_SRC: &str = include_str!("file_open_seed.rs");
const CAP: u64 = super::file::MAX_FILE_SIZE;

fn code_of(src: &str, anchor: &str) -> String {
    code_lines(fn_slice(src, anchor))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The text between the `(` at `open` and its matching `)`.
fn paren_body(s: &str, open: usize) -> &str {
    let mut depth = 0usize;
    for (i, c) in s[open..].char_indices() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return &s[open + 1..open + i];
                }
            }
            _ => {}
        }
    }
    panic!("unbalanced parentheses after {open}");
}

/// The top-level arguments of an argument list (trailing comma allowed).
fn args(list: &str) -> Vec<String> {
    let list = list.trim().trim_end_matches(',');
    let (mut depth, mut cut, mut out) = (0i32, 0, Vec::new());
    for (i, c) in list.char_indices() {
        match c {
            '(' | '[' | '{' | '<' => depth += 1,
            ')' | ']' | '}' | '>' => depth -= 1,
            ',' if depth == 0 => {
                out.push(list[cut..i].trim().to_string());
                cut = i + 1;
            }
            _ => {}
        }
    }
    out.push(list[cut..].trim().to_string());
    out
}

fn last_arg(list: &str) -> String {
    args(list).pop().unwrap_or_default()
}

fn one(body: &str, token: &str) -> usize {
    assert_eq!(body.matches(token).count(), 1, "exactly one `{token}` in:\n{body}");
    body.find(token).unwrap()
}

/// The names in the `let (A, B) =` that binds the call at `at`.
fn tuple_binding(body: &str, at: usize) -> Vec<String> {
    let let_at = body[..at]
        .rfind("let (")
        .unwrap_or_else(|| panic!("no `let (` destructuring before the call:\n{body}"));
    let open = let_at + "let ".len();
    args(paren_body(body, open))
}

/// `detect_encoding_with_confidence` and `decode_bytes` are each called
/// exactly once in `body`, both on `&bytes`.
fn decodes_exactly(body: &str, bytes: &str) {
    for (call, form) in [
        ("detect_encoding_with_confidence(", format!("detect_encoding_with_confidence(&{bytes})")),
        ("decode_bytes(", format!("decode_bytes(&{bytes},")),
    ] {
        assert_eq!(body.matches(call).count(), 1, "one `{call}`:\n{body}");
        assert_eq!(body.matches(form.as_str()).count(), 1, "`{form}`:\n{body}");
    }
}

#[test]
fn open_seeded_decodes_the_bytes_it_seeded() {
    let body = code_of(SEED_SRC, "pub(crate) fn open_file_from_path_seeded(");
    assert!(body.contains("fn open_file_from_path_seeded"), "non-vacuity");
    assert!(body.lines().count() > 10, "non-vacuity: a real body:\n{body}");
    let read = one(&body, "read_for_open(");
    for banned in ["fs::read", "File::open(", "read_once(", "snapshot(", "coherent_read("] {
        assert!(!body.contains(banned), "(ii) `{banned}`:\n{body}");
    }
    let names = tuple_binding(&body, read);
    assert_eq!(names.len(), 2, "(iii) `let (BYTES, SEED)`: {names:?}");
    let (bytes, seed) = (&names[0], &names[1]);
    if body.contains("detect_encoding_with_confidence(") {
        decodes_exactly(&body, bytes);
    } else {
        let call = one(&body, "decode_opened(") + "decode_opened".len();
        let passed = args(paren_body(&body, call));
        let k = passed
            .iter()
            .position(|a| a == bytes)
            .unwrap_or_else(|| panic!("(iii) decode_opened gets `{bytes}`: {passed:?}"));
        assert!(!body.contains("decode_bytes("), "(iii) a second decode:\n{body}");
        let helper = code_of(FILE_SRC, "fn decode_opened(");
        let params = args(paren_body(&helper, helper.find('(').unwrap()));
        let param = params[k].split(':').next().unwrap_or_default().trim().to_string();
        decodes_exactly(&helper, &param);
        for banned in ["fs::read", "File::open(", "read_once(", "snapshot(", "read_for_open("] {
            assert!(!helper.contains(banned), "(ii) helper `{banned}`:\n{helper}");
        }
    }
    let ok = body.rfind("Ok((").unwrap_or_else(|| panic!("(iii) `Ok((`:\n{body}"));
    let tuple = paren_body(&body, ok + "Ok(".len());
    assert_eq!(&last_arg(tuple), seed, "(iii) the seed is returned:\n{body}");
    assert!(body.contains("over_cap"), "(iv) the over-cap branch:\n{body}");
    one(&body, "over_cap_error(");
    assert!(body.contains("Err(over_cap_error("), "(iv) it returns Err:\n{body}");
}

fn assert_open_uses_the_seed(anchor: &str) {
    let body = code_of(FILE_SRC, anchor);
    assert!(body.lines().count() > 3, "non-vacuous slice for {anchor}:\n{body}");
    let call = one(&body, "open_file_from_path_seeded(");
    assert!(!body.contains("open_file_from_path("), "{anchor}: the unseeded open");
    let names = tuple_binding(&body, call);
    assert_eq!(names.len(), 2, "{anchor}: `let (result, seed)`: {names:?}");
    let watch = one(&body, "watch_seeded(") + "watch_seeded".len();
    let arg = last_arg(paren_body(&body, watch));
    assert_eq!(arg, names[1], "{anchor}: registers the open's seed:\n{body}");
    for banned in [".watch(", "snapshot(", "Entry {"] {
        assert!(!body.contains(banned), "{anchor}: `{banned}`:\n{body}");
    }
}

#[test]
fn open_file_wiring_uses_the_seed() {
    assert_open_uses_the_seed("pub async fn open_file(");
    assert_open_uses_the_seed("pub async fn open_file_dialog(");
}

#[test]
fn over_cap_read_maps_to_file_too_large() {
    for (s1, read, size) in [
        (CAP + 7, CAP + 1, CAP + 7),
        (0, CAP + 1, CAP + 1),
        (CAP + 1, CAP + 1, CAP + 1),
    ] {
        let got = serde_json::to_value(over_cap_error("/d/a.md", s1, read)).expect("json");
        let want = serde_json::to_value(FileError::FileTooLarge {
            path: "/d/a.md".to_string(),
            size,
        })
        .expect("json");
        assert_eq!(got, want, "s1={s1} read={read}");
    }
}
