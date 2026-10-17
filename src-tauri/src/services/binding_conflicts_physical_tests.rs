//! Audit b186 F1(b), the Rust twin of `tests/binding-physical-overlap.test.ts`:
//! A = mods+Shift+k1 and B = the same mods+k2, where Shift+k1 types k2 on the
//! US or German layout, resolve A to `physicalOverlap` (flagged) and leave B
//! bound when at least one is custom. French (outside the table) is not
//! flagged: the stated limit.

use super::SHIFTED_ON_LAYOUTS;
use crate::menu_layout::Platform;
use crate::services::binding_conflicts::{resolve_bindings, Resolution, SuppressReason};
use std::collections::BTreeMap;

const PLATFORMS: [Platform; 3] = [Platform::Macos, Platform::Windows, Platform::Linux];

fn resolve(p: Platform, v: u32, stored: &[(&str, &str)]) -> BTreeMap<String, Resolution> {
    let stored = stored
        .iter()
        .map(|(f, s)| (f.to_string(), s.to_string()))
        .collect();
    resolve_bindings(p, v, &stored).expect("the committed layout parses")
}

fn overlap(id: &str) -> Resolution {
    Resolution::Suppressed {
        reason: SuppressReason::PhysicalOverlap,
        conflicts_with: vec![id.to_string()],
        flagged: true,
    }
}

/// Save on Cmd+Shift+= yields to who owns Cmd+Shift+` (German Shift+= types
/// `): Code, and off-Mac at v1 also Strikethrough (Ctrl+Shift+` collapses).
fn backquote(p: Platform, v: u32) -> Resolution {
    let mut ids = vec!["format.code".to_string()];
    if v < 2 && p != Platform::Macos {
        ids.push("format.strike".to_string());
    }
    Resolution::Suppressed {
        reason: SuppressReason::PhysicalOverlap,
        conflicts_with: ids,
        flagged: true,
    }
}

fn bound(chord: &str) -> Resolution {
    Resolution::Bound {
        chord: chord.to_string(),
    }
}

#[test]
fn the_table_has_the_21_k8_keys_with_their_us_and_german_shifted_characters() {
    let want = [
        ("0", ")", "="),
        ("1", "!", "!"),
        ("2", "@", "\""),
        ("3", "#", "§"),
        ("4", "$", "$"),
        ("5", "%", "%"),
        ("6", "^", "&"),
        ("7", "&", "/"),
        ("8", "*", "("),
        ("9", "(", ")"),
        ("`", "~", "°"),
        ("-", "_", "?"),
        ("=", "+", "`"),
        ("[", "{", "Ü"),
        ("]", "}", "*"),
        ("\\", "|", "'"),
        (";", ":", "Ö"),
        ("'", "\"", "Ä"),
        (",", "<", ";"),
        (".", ">", ":"),
        ("/", "?", "_"),
    ];
    assert_eq!(SHIFTED_ON_LAYOUTS, want);
}

#[test]
fn codex_pair_and_german_slash_pair_are_flagged_on_every_platform_and_version() {
    for p in PLATFORMS {
        for v in [1, 2] {
            let a = resolve(
                p,
                v,
                &[("fileNew", "Cmd+Shift+0"), ("fileSave", "Cmd+Shift+=")],
            );
            assert_eq!(a["fileNew"], overlap("file.save"), "{p:?} v{v}");
            assert_eq!(a["fileSave"], backquote(p, v), "{p:?} v{v}");
            let b = resolve(
                p,
                v,
                &[("fileOpen", "Cmd+Shift+/"), ("fileSave", "Cmd+Shift+_")],
            );
            assert_eq!(b["fileOpen"], overlap("file.save"), "{p:?} v{v}");
            assert_eq!(b["fileSave"], bound("Cmd+Shift+_"), "{p:?} v{v}");
        }
    }
}

#[test]
fn a_v2_default_shadowed_by_a_custom_is_flagged() {
    for p in PLATFORMS {
        let r = resolve(p, 2, &[("fileSave", "Cmd+Shift+=")]);
        assert_eq!(r["paragraphParagraph"], overlap("file.save"), "{p:?}");
        assert_eq!(r["fileSave"], overlap("format.code"), "{p:?}");
    }
}

#[test]
fn french_period_pair_is_outside_the_table_and_not_flagged() {
    for p in PLATFORMS {
        for v in [1, 2] {
            let r = resolve(
                p,
                v,
                &[("fileNew", "Cmd+Shift+."), ("fileClose", "Cmd+Shift+/")],
            );
            assert_eq!(r["fileNew"], bound("Cmd+Shift+."), "{p:?} v{v}");
            assert_eq!(r["fileClose"], bound("Cmd+Shift+/"), "{p:?} v{v}");
        }
    }
}

#[test]
fn unproduced_k2_and_other_modifier_sets_are_not_flagged() {
    for p in PLATFORMS {
        for (a, b) in [
            ("Cmd+Shift+0", "Cmd+Shift+9"),
            ("Cmd+Option+Shift+0", "Cmd+Option+="),
            ("Cmd+Shift+0", "Cmd+Option+Shift+="),
        ] {
            let r = resolve(p, 1, &[("fileNew", a), ("fileSave", b)]);
            assert_eq!(r["fileNew"], bound(a), "{p:?} {a} {b}");
            assert_eq!(r["fileSave"], bound(b), "{p:?} {a} {b}");
        }
    }
}

#[test]
fn defaults_alone_never_resolve_physical_overlap() {
    for p in PLATFORMS {
        for v in [1, 2] {
            let hits: Vec<String> = resolve(p, v, &[])
                .into_iter()
                .filter(|(_, r)| {
                    matches!(
                        r,
                        Resolution::Suppressed {
                            reason: SuppressReason::PhysicalOverlap,
                            ..
                        }
                    )
                })
                .map(|(f, _)| f)
                .collect();
            assert!(hits.is_empty(), "{p:?} v{v}: {hits:?}");
        }
    }
}

#[test]
fn every_table_pair_is_flagged_when_both_sides_bind_alone() {
    let mut pairs = 0;
    let mut failures = Vec::new();
    for p in PLATFORMS {
        for (k1, us, de) in SHIFTED_ON_LAYOUTS {
            let mut targets = vec![us, de];
            targets.dedup();
            for k2 in targets {
                if k2 == k1 || !k2.is_ascii() || k2 == "+" {
                    continue;
                }
                let a = format!("Cmd+Option+Shift+{k1}");
                let b = format!("Cmd+Option+Shift+{k2}");
                let alone_a = resolve(p, 1, &[("fileNew", &a)]).remove("fileNew");
                let alone_b = resolve(p, 1, &[("fileSave", &b)]).remove("fileSave");
                let (Some(Resolution::Bound { .. }), Some(b_res @ Resolution::Bound { .. })) =
                    (alone_a, alone_b)
                else {
                    continue;
                };
                let r = resolve(p, 1, &[("fileNew", &a), ("fileSave", &b)]);
                if r["fileNew"] != overlap("file.save") || r["fileSave"] != b_res {
                    failures.push(format!("{p:?} {a} {b}"));
                }
                pairs += 1;
            }
        }
    }
    assert!(failures.is_empty(), "{failures:?}");
    assert!(pairs >= 90, "{pairs} pairs");
}
