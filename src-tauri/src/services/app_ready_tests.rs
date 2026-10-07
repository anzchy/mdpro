use super::{app_ready_context, current_app_ready_context};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const KEYS: [&str; 5] = ["appVersion", "buildId", "pid", "platform", "startupTimeMs"];

/// The env var name, assembled so this file's own source never contains it
/// (WI-2/T08 scans every `.rs` file, this one included).
const NEEDLE: &str = concat!("MDPRO_", "BUILD_ID");

fn v1() -> String {
    "0123456789abcdef".repeat(4)
}

fn v2() -> String {
    "fedcba9876543210".repeat(4)
}

fn sorted_keys(ctx: &Value) -> Vec<String> {
    let mut keys: Vec<String> = ctx
        .as_object()
        .expect("context is a JSON object")
        .keys()
        .cloned()
        .collect();
    keys.sort();
    keys
}

/// A deterministic 64-bit LCG (Knuth MMIX constants).
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0
    }

    fn string(&mut self) -> String {
        const ALPHABET: [char; 12] = ['a', 'Z', '0', '9', ' ', '.', '-', '"', '\\', 'é', '/', '_'];
        let len = (self.next() >> 33) % 12;
        (0..len)
            .map(|_| ALPHABET[((self.next() >> 33) % ALPHABET.len() as u64) as usize])
            .collect()
    }
}

#[test]
fn t01_pure_constructor_equals_whole_literal() {
    let ctx = app_ready_context(1234, "0.3.0", "macos", 4242, &v1());
    let expected = json!({
        "startupTimeMs": 1234,
        "appVersion": "0.3.0",
        "platform": "macos",
        "pid": 4242,
        "buildId": v1()
    });
    assert_eq!(ctx, expected);
}

#[test]
fn t02_second_literal_with_zero_and_empty_inputs() {
    let ctx = app_ready_context(0, "", "linux", 0, "unknown");
    let expected = json!({
        "startupTimeMs": 0,
        "appVersion": "",
        "platform": "linux",
        "pid": 0,
        "buildId": "unknown"
    });
    assert_eq!(ctx, expected);
}

#[test]
fn t03_numeric_maxima_are_not_truncated() {
    let ctx = app_ready_context(u64::MAX, "v", "p", u32::MAX, &v1());
    assert!(ctx["startupTimeMs"].is_u64(), "startupTimeMs: {}", ctx);
    assert!(ctx["pid"].is_u64(), "pid: {}", ctx);
    assert_eq!(ctx["startupTimeMs"].as_u64(), Some(u64::MAX));
    assert_eq!(ctx["pid"].as_u64(), Some(u32::MAX as u64));
}

#[test]
fn t04_key_set_and_passthrough_property() {
    let mut rng = Lcg(0xa99);
    for i in 0..200 {
        let s = rng.next();
        let p = (rng.next() >> 32) as u32;
        let v = rng.string();
        let pl = rng.string();
        let b = [v1(), "unknown".to_string()][(rng.next() >> 33) as usize % 2].clone();
        let ctx = app_ready_context(s, &v, &pl, p, &b);
        let msg = format!("seed 0xa99, tuple {i}: {ctx}");
        assert_eq!(sorted_keys(&ctx), KEYS, "{msg}");
        assert_eq!(ctx["startupTimeMs"].as_u64(), Some(s), "{msg}");
        assert_eq!(ctx["pid"].as_u64(), Some(p as u64), "{msg}");
        assert_eq!(ctx["appVersion"].as_str(), Some(v.as_str()), "{msg}");
        assert_eq!(ctx["platform"].as_str(), Some(pl.as_str()), "{msg}");
        assert_eq!(ctx["buildId"].as_str(), Some(b.as_str()), "{msg}");
    }
}

#[test]
fn t05_pid_equals_the_real_process_id() {
    let ctx = current_app_ready_context(7, None);
    assert_eq!(ctx["pid"].as_u64(), Some(std::process::id() as u64));
}

#[test]
fn t06_build_id_flows_through_normalisation() {
    let (a, b, upper) = (v1(), v2(), v1().to_uppercase());
    let cases: [(Option<&str>, &str); 5] = [
        (Some(&a), &a),
        (Some(&b), &b),
        (None, "unknown"),
        (Some(&upper), "unknown"),
        (Some(" "), "unknown"),
    ];
    for (raw, expected) in cases {
        let ctx = current_app_ready_context(7, raw);
        assert_eq!(ctx["buildId"].as_str(), Some(expected), "raw {raw:?}");
    }
}

#[test]
fn t07_remaining_fields_are_real_and_key_set_is_closed() {
    for startup in [7u64, 9] {
        let ctx = current_app_ready_context(startup, None);
        assert_eq!(ctx["startupTimeMs"].as_u64(), Some(startup));
        assert_eq!(ctx["appVersion"].as_str(), Some(env!("CARGO_PKG_VERSION")));
        assert_eq!(ctx["platform"].as_str(), Some(std::env::consts::OS));
        assert_eq!(sorted_keys(&ctx), KEYS);
    }
}

fn is_ident(c: Option<&char>) -> bool {
    c.is_some_and(|c| c.is_alphanumeric() || *c == '_')
}

/// Remove `//` and (nested) `/* */` comments, keeping string and char
/// literals intact and every newline in place.
fn strip_comments(src: &str) -> String {
    let c: Vec<char> = src.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < c.len() {
        let next = c.get(i + 1).copied();
        if c[i] == '/' && next == Some('/') {
            while i < c.len() && c[i] != '\n' {
                i += 1;
            }
        } else if c[i] == '/' && next == Some('*') {
            let mut depth = 1;
            i += 2;
            while i < c.len() && depth > 0 {
                let n = c.get(i + 1).copied();
                if c[i] == '/' && n == Some('*') {
                    depth += 1;
                    i += 2;
                } else if c[i] == '*' && n == Some('/') {
                    depth -= 1;
                    i += 2;
                } else {
                    if c[i] == '\n' {
                        out.push('\n');
                    }
                    i += 1;
                }
            }
        } else if c[i] == 'r' && !is_ident(i.checked_sub(1).and_then(|p| c.get(p)))
            || c[i] == 'r' && i >= 1 && c[i - 1] == 'b'
        {
            let mut j = i + 1;
            while c.get(j) == Some(&'#') {
                j += 1;
            }
            let hashes = j - i - 1;
            if c.get(j) != Some(&'"') {
                out.push(c[i]);
                i += 1;
                continue;
            }
            let close = format!("\"{}", "#".repeat(hashes));
            let rest: String = c[j + 1..].iter().collect();
            let end = rest.find(&close).map_or(rest.len(), |e| e + close.len());
            out.extend(c[i..=j].iter());
            out.push_str(&rest[..end]);
            i = j + 1 + rest[..end].chars().count();
        } else if c[i] == '"' {
            out.push('"');
            i += 1;
            while i < c.len() {
                out.push(c[i]);
                if c[i] == '\\' && i + 1 < c.len() {
                    out.push(c[i + 1]);
                    i += 2;
                    continue;
                }
                i += 1;
                if c[i - 1] == '"' {
                    break;
                }
            }
        } else if c[i] == '\'' && next == Some('\\') {
            let mut j = i + 2;
            while j < c.len() && c[j] != '\'' {
                j += 1;
            }
            out.extend(c[i..=j.min(c.len() - 1)].iter());
            i = j + 1;
        } else if c[i] == '\'' && c.get(i + 2) == Some(&'\'') {
            out.extend(c[i..i + 3].iter());
            i += 3;
        } else {
            out.push(c[i]);
            i += 1;
        }
    }
    out
}

fn rs_files(dir: &Path, acc: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("read src dir") {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            rs_files(&path, acc);
        } else if path.extension().is_some_and(|e| e == "rs") {
            acc.push(path);
        }
    }
}

/// `true` when `line` holds `option_env!("<NEEDLE>")` as a whole token.
fn is_option_env_read(line: &str) -> bool {
    let compact: String = line.chars().filter(|c| !c.is_whitespace()).collect();
    let call = format!("option_env!(\"{NEEDLE}\")");
    compact.match_indices(&call).any(|(at, _)| {
        let before = compact[..at].chars().last();
        !is_ident(before.as_ref())
    })
}

#[test]
fn t08_build_id_read_only_by_option_env_in_main_rs() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    rs_files(&root.join("src"), &mut files);
    files.push(root.join("build.rs"));
    files.sort();
    let mut hits = Vec::new();
    for file in &files {
        let src = std::fs::read_to_string(file).expect("read rs file");
        let rel = file.strip_prefix(root).expect("under manifest dir");
        let rel = rel.to_string_lossy().replace('\\', "/");
        for line in strip_comments(&src).lines() {
            if line.contains(NEEDLE) {
                hits.push((rel.clone(), line.trim().to_string()));
            }
        }
    }
    assert_eq!(
        hits.len(),
        1,
        "code lines naming the build id var: {hits:?}"
    );
    assert_eq!(hits[0].0, "src/main.rs", "{hits:?}");
    assert!(is_option_env_read(&hits[0].1), "{hits:?}");

    let build_rs = std::fs::read_to_string(root.join("build.rs")).expect("read build.rs");
    assert!(
        !build_rs.contains(NEEDLE),
        "build.rs names the build id var"
    );

    let main_rs = std::fs::read_to_string(root.join("src/main.rs")).expect("read main.rs");
    let lines = main_rs.lines().count();
    assert!(lines <= 525, "main.rs has {lines} lines, limit 525");
}

#[test]
fn t08_stripper_self_check() {
    let src = "let a = \"// kept\"; // gone\n/* gone /* nested */ gone */ let b = 'x';\nlet c = r#\"/* kept */\"#; let l: &'static str = \"\\\"//kept\";";
    let out = strip_comments(src);
    assert!(out.contains("\"// kept\""), "{out}");
    assert!(!out.contains("gone"), "{out}");
    assert!(out.contains("let b = 'x';"), "{out}");
    assert!(out.contains("r#\"/* kept */\"#"), "{out}");
    assert!(out.contains("\"\\\"//kept\""), "{out}");
    assert_eq!(out.lines().count(), 3, "{out}");
    let call = format!("const X: Option<&str> = option_env!( \"{NEEDLE}\" );");
    assert!(is_option_env_read(&call));
    assert!(!is_option_env_read(&format!("std::env::var(\"{NEEDLE}\")")));
    assert!(!is_option_env_read(&format!(
        "my_option_env!(\"{NEEDLE}\")"
    )));
}
