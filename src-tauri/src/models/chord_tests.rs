//! M1A-WI-5: the Rust twin of `tests/chord.test.ts`. Both run the `parse`
//! rows of `tests/fixtures/binding-owner-cases.json` and the same laws:
//! normalise is idempotent, parse(format(parse(s))) == parse(s), validity is
//! platform-independent, adding Ctrl to a Cmd chord changes nothing off-Mac
//! and always changes it on macOS, and no input panics.
use super::*;
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../tests/fixtures/binding-owner-cases.json");
const PLATFORMS: [Platform; 3] = [Platform::Macos, Platform::Windows, Platform::Linux];
const MODS: [&str; 4] = ["Cmd", "Ctrl", "Option", "Shift"];
/// The 41 valid keys of the domain's 44-key pool, space-separated.
const VALID_KEYS: &str = "A a Z z m 0 5 9 ` - = [ ] \\ ; ' , . / Up ArrowUp Down ArrowDown Left \
    ArrowLeft Right ArrowRight Space Backspace Delete Enter Tab Escape Home End PageUp PageDown \
    F1 F6 F11 F12";
const F_KEYS: [&str; 4] = ["F1", "F6", "F11", "F12"];
const INVALID_KEYS: [&str; 3] = ["F13", "Esc", "é"];
const CMD: u8 = 1;
const CTRL: u8 = 2;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ParseRow {
    platform: Platform,
    input: String,
    normalised: Option<String>,
}

/// R1-13a: a strict loader. Unknown top-level keys and unknown row keys fail.
fn load_parse_rows(text: &str) -> Result<Vec<ParseRow>, String> {
    let raw: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let top = raw.as_object().ok_or("top level is not an object")?;
    let allowed = ["$comment", "parse", "cases", "sweep"];
    if let Some(k) = top.keys().find(|k| !allowed.contains(&k.as_str())) {
        return Err(format!("unknown top-level key {k}"));
    }
    let parse = top.get("parse").cloned().ok_or("no parse section")?;
    serde_json::from_value(parse).map_err(|e| e.to_string())
}

fn raw_parse_len() -> usize {
    let raw: Value = serde_json::from_str(FIXTURE).expect("fixture is JSON");
    raw["parse"].as_array().expect("parse is an array").len()
}

/// Every modifier subset, canonical and reversed order, × the 44-key pool:
/// `(string, mask, key)`.
fn domain() -> Vec<(String, u8, &'static str)> {
    let mut out = Vec::new();
    for mask in 0u8..16 {
        let mods: Vec<&str> = (0..4)
            .filter(|i| (mask >> i) & 1 == 1)
            .map(|i| MODS[i])
            .collect();
        let reversed: Vec<&str> = mods.iter().rev().copied().collect();
        for order in [&mods, &reversed] {
            for key in VALID_KEYS.split_whitespace().chain(INVALID_KEYS) {
                let mut parts = order.clone();
                parts.push(key);
                out.push((parts.join("+"), mask, key));
            }
        }
    }
    out
}

#[test]
fn fixture_has_41_valid_54_null_rows_and_every_platform() {
    let rows = load_parse_rows(FIXTURE).expect("fixture loads");
    assert_eq!(rows.iter().filter(|r| r.normalised.is_some()).count(), 41);
    assert_eq!(rows.iter().filter(|r| r.normalised.is_none()).count(), 54);
    for p in PLATFORMS {
        assert!(rows.iter().any(|r| r.platform == p), "{p:?} missing");
    }
}

#[test]
fn strict_loader_rejects_extra_and_misspelt_keys() {
    let extra = r#"{"parse":[{"platform":"macos","input":"F5","normalised":"F5","x":1}]}"#;
    let misspelt = r#"{"parse":[{"platform":"macos","input":"F5","normalsed":"F5"}]}"#;
    let top = r#"{"parse":[],"cses":[]}"#;
    assert!(load_parse_rows(extra).is_err());
    assert!(load_parse_rows(misspelt).is_err());
    assert!(load_parse_rows(top).is_err());
}

#[test]
fn every_fixture_row_normalises_to_its_expected_value() {
    let rows = load_parse_rows(FIXTURE).expect("fixture loads");
    let mut mismatches = Vec::new();
    let mut executed = 0usize;
    for row in &rows {
        let got = normalise_stored(&row.input, row.platform);
        executed += 1;
        if got != row.normalised {
            mismatches.push(format!("{:?} {:?}: {got:?}", row.platform, row.input));
        }
    }
    assert_eq!(mismatches, Vec::<String>::new());
    assert_eq!(executed, raw_parse_len());
}

#[test]
fn c6_off_mac_collapses_cmd_and_ctrl_mac_keeps_them_apart() {
    let inputs = ["Cmd+Ctrl+I", "Cmd+I", "Ctrl+I"];
    for p in [Platform::Windows, Platform::Linux] {
        for s in inputs {
            assert_eq!(
                normalise_stored(s, p).as_deref(),
                Some("Cmd+I"),
                "{p:?} {s}"
            );
        }
    }
    let mac: Vec<Option<String>> = inputs
        .iter()
        .map(|s| normalise_stored(s, Platform::Macos))
        .collect();
    let expected: Vec<Option<String>> = inputs.iter().map(|s| Some(s.to_string())).collect();
    assert_eq!(mac, expected);
}

#[test]
fn domain_has_4224_strings_and_3714_valid() {
    let entries = domain();
    assert_eq!(VALID_KEYS.split_whitespace().count(), 41);
    assert_eq!(entries.len() * PLATFORMS.len(), 4224);
    let mut valid = 0;
    let mut wrong = Vec::new();
    for p in PLATFORMS {
        for (s, mask, key) in &entries {
            let is_valid = parse_chord(s, p).is_some();
            let should = !INVALID_KEYS.contains(key) && (*mask != 0 || F_KEYS.contains(key));
            if is_valid {
                valid += 1;
            }
            if is_valid != should {
                wrong.push(format!("{p:?} {s}"));
            }
        }
    }
    assert_eq!(valid, 3714);
    assert_eq!(wrong, Vec::<String>::new());
}

#[test]
fn validity_does_not_depend_on_the_platform() {
    let mut inputs: Vec<String> = domain().into_iter().map(|(s, _, _)| s).collect();
    let rows = load_parse_rows(FIXTURE).expect("fixture loads");
    inputs.extend(rows.into_iter().map(|r| r.input));
    assert!(inputs.len() > 1408);
    let disagree: Vec<&String> = inputs
        .iter()
        .filter(|s| {
            let nulls: Vec<bool> = PLATFORMS
                .iter()
                .map(|p| parse_chord(s, *p).is_none())
                .collect();
            nulls.iter().any(|n| *n != nulls[0])
        })
        .collect();
    assert!(disagree.is_empty(), "{disagree:?}");
}

#[test]
fn normalise_is_idempotent_and_parse_format_round_trips() {
    let mut broken = Vec::new();
    let mut checked = 0;
    for (s, _, _) in domain() {
        let Some(raw) = parse_chord(&s, Platform::Macos) else {
            continue;
        };
        for p in PLATFORMS {
            checked += 1;
            let once = normalise_chord(&raw, p);
            let parsed = parse_chord(&s, p);
            if normalise_chord(&once, p) != once {
                broken.push(format!("idem {p:?} {s}"));
            }
            if parsed.as_ref() != Some(&once) {
                broken.push(format!("parse {p:?} {s}"));
                continue;
            }
            if parse_chord(&format_chord(&once), p).as_ref() != Some(&once) {
                broken.push(format!("round {p:?} {s}"));
            }
            if normalise_stored(&s, p) != Some(format_chord(&once)) {
                broken.push(format!("stored {p:?} {s}"));
            }
        }
    }
    assert_eq!(checked, 3714);
    assert_eq!(broken, Vec::<String>::new());
}

#[test]
fn normalise_chord_canonicalises_a_hand_built_chord() {
    let built = Chord {
        cmd: true,
        ctrl: true,
        option: false,
        shift: false,
        key: "ArrowUp".to_string(),
    };
    assert_eq!(
        format_chord(&normalise_chord(&built, Platform::Macos)),
        "Cmd+Ctrl+Up"
    );
    assert_eq!(
        format_chord(&normalise_chord(&built, Platform::Windows)),
        "Cmd+Up"
    );
    let q = Chord {
        ctrl: false,
        key: "q".to_string(),
        ..built
    };
    assert_eq!(format_chord(&normalise_chord(&q, Platform::Linux)), "Cmd+Q");
}

#[test]
fn adding_ctrl_to_a_cmd_chord_is_a_no_op_off_mac_and_a_change_on_mac() {
    let mut broken = Vec::new();
    let mut pairs = 0;
    for (s, mask, _) in domain() {
        if mask & CMD == 0 || mask & CTRL != 0 || parse_chord(&s, Platform::Macos).is_none() {
            continue;
        }
        let with_ctrl = format!("Ctrl+{s}");
        let swapped = s.replacen("Cmd", "Ctrl", 1);
        for p in PLATFORMS {
            pairs += 1;
            let before = normalise_stored(&s, p);
            let after = normalise_stored(&with_ctrl, p);
            if p == Platform::Macos {
                if after.is_none() || after == before {
                    broken.push(format!("same {p:?} {s}"));
                }
                if after == normalise_stored(&swapped, p) {
                    broken.push(format!("swap {p:?} {s}"));
                }
            } else if after != before {
                broken.push(format!("differs {p:?} {s}"));
            }
        }
    }
    assert!(pairs >= 500, "{pairs}");
    assert_eq!(broken, Vec::<String>::new());
}

#[test]
fn junk_input_never_panics_and_any_result_is_its_own_normal_form() {
    let alphabet = ["C", "m", "d", "+", "S", "0", " ", "<", ">", "é"];
    let mut junk = vec![String::new()];
    let mut level = vec![String::new()];
    for _ in 0..3 {
        level = level
            .iter()
            .flat_map(|s| alphabet.iter().map(move |c| format!("{s}{c}")))
            .collect();
        junk.extend(level.iter().cloned());
    }
    assert_eq!(junk.len(), 1111);
    junk.push("+".repeat(10_000));
    junk.push(format!("{}S", "Cmd+".repeat(1_000)));
    junk.extend(["Cmd+😀", "\0", "Cmd+\0"].map(String::from));
    let mut broken = Vec::new();
    for s in &junk {
        for p in PLATFORMS {
            let result = std::panic::catch_unwind(|| {
                let _ = parse_chord(s, p);
                normalise_stored(s, p)
            });
            match result {
                Err(_) => broken.push(format!(
                    "panicked {p:?} {:?}",
                    s.chars().take(20).collect::<String>()
                )),
                Ok(Some(n)) if normalise_stored(&n, p).as_deref() != Some(n.as_str()) => {
                    broken.push(format!("closure {p:?} {s}"))
                }
                Ok(_) => {}
            }
        }
    }
    assert_eq!(broken, Vec::<String>::new());
    assert_eq!(normalise_stored("Cmd+😀", Platform::Macos), None);
    assert_eq!(normalise_stored(&"+".repeat(10_000), Platform::Linux), None);
}
