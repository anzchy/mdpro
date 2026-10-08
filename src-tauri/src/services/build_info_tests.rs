use super::normalize_build_id;

const UNKNOWN: &str = "unknown";

fn v1() -> String {
    "0123456789abcdef".repeat(4)
}

fn v2() -> String {
    "fedcba9876543210".repeat(4)
}

/// Test-side oracle, independent of the implementation.
fn is_valid(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn replace_char_at(s: &str, idx: usize, c: char) -> String {
    s.chars()
        .enumerate()
        .map(|(i, x)| if i == idx { c } else { x })
        .collect()
}

fn pad_right_a(prefix: &str) -> String {
    let mut s = prefix.to_string();
    while s.len() < 64 {
        s.push('a');
    }
    s
}

fn t04_inputs() -> Vec<String> {
    [0usize, 1, 63, 64, 65, 128]
        .iter()
        .map(|&n| "a".repeat(n))
        .collect()
}

fn t05_inputs() -> Vec<String> {
    let v = v1();
    vec![
        replace_char_at(&v, 10, 'A'),
        replace_char_at(&v, 10, 'g'),
        v.to_uppercase(),
    ]
}

fn t06_inputs() -> Vec<String> {
    let v = v1();
    vec![
        format!(" {v}"),
        format!("{v}\n"),
        format!("{v} "),
        format!("{} ", &v[..63]),
        replace_char_at(&v, 31, '\t'),
    ]
}

fn t07_inputs() -> Vec<String> {
    vec![
        pad_right_a("/Users/x/"),
        pad_right_a("..\\a\\"),
        pad_right_a("../../"),
    ]
}

fn t08_inputs() -> Vec<String> {
    vec![
        "é".repeat(32),
        format!("{}é", "a".repeat(63)),
        format!("ａ{}", "a".repeat(63)),
    ]
}

fn t09_inputs() -> Vec<String> {
    let v: Vec<char> = v1().chars().collect();
    let mut out = Vec::new();
    for code in 0u32..=0xFF {
        let c = char::from_u32(code).expect("U+0000..=U+00FF are all chars");
        for pos in [0usize, 31, 63] {
            let mut chars = v.clone();
            chars[pos] = c;
            out.push(chars.into_iter().collect());
        }
    }
    out
}

/// Deterministic u64 LCG (Knuth MMIX constants).
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

const T10_SEED: u64 = 0x6d6470726f;
const T10_COUNT: usize = 2000;

fn t10_generated() -> Vec<String> {
    let alphabet: Vec<char> = "0123456789abcdefABCDEFgG /\\\té.".chars().collect();
    let valid: Vec<char> = "0123456789abcdef".chars().collect();
    let mut rng = Lcg(T10_SEED);
    (0..T10_COUNT)
        .map(|_| {
            if rng.below(4) == 0 {
                (0..64).map(|_| valid[rng.below(valid.len())]).collect()
            } else {
                let len = 60 + rng.below(9);
                (0..len)
                    .map(|_| alphabet[rng.below(alphabet.len())])
                    .collect()
            }
        })
        .collect()
}

/// Every `Some` input from T02-T09 plus the seeded T10 strings.
fn t10_corpus() -> Vec<String> {
    let mut all = vec![String::new(), v1(), v2()];
    all.extend(t04_inputs());
    all.extend(t05_inputs());
    all.extend(t06_inputs());
    all.extend(t07_inputs());
    all.extend(t08_inputs());
    all.extend(t09_inputs());
    all.extend(t10_generated());
    all
}

#[test]
fn t01_none_gives_unknown() {
    assert_eq!(normalize_build_id(None), UNKNOWN);
}

#[test]
fn t02_empty_string_gives_unknown() {
    assert_eq!(normalize_build_id(Some("")), UNKNOWN);
}

#[test]
fn t03_two_valid_ids_come_back_byte_for_byte() {
    for v in [v1(), v2()] {
        let out = normalize_build_id(Some(&v));
        assert_eq!(out, v);
        assert_eq!(out.len(), 64);
    }
}

#[test]
fn t04_length_partitions() {
    for n in [0usize, 1, 63, 64, 65, 128] {
        let s = "a".repeat(n);
        let expected = if n == 64 { s.as_str() } else { UNKNOWN };
        assert_eq!(normalize_build_id(Some(&s)), expected, "n = {n}");
    }
}

#[test]
fn t05_charset_violations_at_length_64() {
    for s in t05_inputs() {
        assert_eq!(s.chars().count(), 64, "fixture {s:?}");
        assert_eq!(normalize_build_id(Some(&s)), UNKNOWN, "input {s:?}");
    }
}

#[test]
fn t06_whitespace_is_never_trimmed() {
    for s in t06_inputs() {
        assert_eq!(normalize_build_id(Some(&s)), UNKNOWN, "input {s:?}");
    }
}

#[test]
fn t07_path_shaped_64_char_strings() {
    for s in t07_inputs() {
        assert_eq!(s.len(), 64, "fixture {s:?}");
        let out = normalize_build_id(Some(&s));
        assert_eq!(out, UNKNOWN, "input {s:?}");
        assert!(!out.contains('/') && !out.contains('\\'), "output {out:?}");
    }
}

#[test]
fn t08_non_ascii_char_count_and_byte_length_disagree() {
    for s in t08_inputs() {
        assert_eq!(normalize_build_id(Some(&s)), UNKNOWN, "input {s:?}");
    }
}

#[test]
fn t09_single_char_substitution_property() {
    let v: Vec<char> = v1().chars().collect();
    let mut checked = 0usize;
    for code in 0u32..=0xFF {
        let c = char::from_u32(code).expect("U+0000..=U+00FF are all chars");
        for pos in [0usize, 31, 63] {
            let mut chars = v.clone();
            chars[pos] = c;
            let s: String = chars.into_iter().collect();
            let out = normalize_build_id(Some(&s));
            if c.is_ascii_digit() || ('a'..='f').contains(&c) {
                assert_eq!(out, s, "c = U+{code:04X}, pos = {pos}");
            } else {
                assert_eq!(out, UNKNOWN, "c = U+{code:04X}, pos = {pos}");
            }
            checked += 1;
        }
    }
    assert_eq!(checked, 768);
}

#[test]
fn t10_output_range_property_over_seeded_corpus() {
    let mut valid_count = 0usize;
    let mut invalid_count = 0usize;
    for s in t10_corpus() {
        let out = normalize_build_id(Some(&s));
        if is_valid(&s) {
            valid_count += 1;
            assert_eq!(out, s, "seed {T10_SEED:#x}, input {s:?}");
        } else {
            invalid_count += 1;
            assert_eq!(out, UNKNOWN, "seed {T10_SEED:#x}, input {s:?}");
        }
        assert!(out == UNKNOWN || is_valid(out), "output {out:?}");
        assert!(
            !out.contains('/') && !out.contains('\\') && !out.chars().any(char::is_whitespace),
            "output {out:?}"
        );
    }
    let none_out = normalize_build_id(None);
    assert!(none_out == UNKNOWN || is_valid(none_out));
    assert!(valid_count > 0, "seed {T10_SEED:#x}: no valid inputs");
    assert!(invalid_count > 0, "seed {T10_SEED:#x}: no invalid inputs");
}

#[test]
fn t11_idempotence() {
    let mut inputs: Vec<Option<String>> = t10_corpus().into_iter().map(Some).collect();
    inputs.push(None);
    for x in &inputs {
        let once = normalize_build_id(x.as_deref());
        let twice = normalize_build_id(Some(once));
        assert_eq!(twice, once, "input {x:?}");
    }
    assert_eq!(normalize_build_id(Some(UNKNOWN)), UNKNOWN);
}
