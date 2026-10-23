//! M1A-WI-8: the filter's laws in Rust, over the shared 19-value pool of the
//! fixture's `sweep` section: at most one owner over the single-custom sweep,
//! unassigning never unbinds another row, the M1b rewrite is stable, and
//! reversing the table, the inventory or the reserved list changes nothing
//! (R3-1). The stored map is a `BTreeMap`, so its insertion order cannot
//! vary in Rust; the TS side covers stored-order independence. Mocked: nothing.
use super::sweep_tests::{resolve, sweep, VERSIONS};
use super::tests::{chord_platform, fixture, layout, Map, PLATFORMS};
use super::*;
use crate::menu_layout::{CommandRow, Disposition, KeySpec};
use crate::models::chord::normalise_stored;

fn key_of(row: &CommandRow, p: Platform) -> &KeySpec {
    match p {
        Platform::Macos => &row.key.macos,
        Platform::Windows => &row.key.windows,
        Platform::Linux => &row.key.linux,
    }
}

fn available_contexts(row: &CommandRow, p: Platform, v: u32) -> Vec<OwnershipContext> {
    let a = match p {
        Platform::Macos => &row.availability.macos,
        Platform::Windows => &row.availability.windows,
        Platform::Linux => &row.availability.linux,
    };
    let (w, s) = match if v >= 2 { a.v2 } else { a.v1 } {
        Availability::Both => (true, true),
        Availability::W => (true, false),
        Availability::S => (false, true),
        Availability::None => (false, false),
    };
    let ok = |c: &&OwnershipContext| match c {
        OwnershipContext::EditorW | OwnershipContext::TableW => w,
        OwnershipContext::EditorS | OwnershipContext::TableS => s,
        OwnershipContext::Modal | OwnershipContext::Recorder | OwnershipContext::NativeFocus => {
            false
        }
    };
    row.contexts.iter().filter(ok).copied().collect()
}

fn config_rows() -> Vec<&'static CommandRow> {
    layout()
        .rows
        .iter()
        .filter(|r| r.pref_field.is_some())
        .collect()
}

fn fields() -> Vec<String> {
    let mut f: Vec<String> = config_rows()
        .iter()
        .filter_map(|r| r.pref_field.clone())
        .collect();
    f.sort();
    f
}

fn single_inputs(pool: &[String]) -> Vec<(Platform, u32, Map)> {
    let mut out = Vec::new();
    for p in PLATFORMS {
        for v in VERSIONS {
            for f in fields() {
                for x in pool {
                    out.push((p, v, Map::from([(f.clone(), x.clone())])));
                }
            }
        }
    }
    out
}

fn law_one(p: Platform, v: u32, stored: &Map, s: &BindingState, out: &mut Vec<String>) {
    let exempt = |id: &str| {
        layout().editor_owned.iter().any(|r| {
            matches!(
                r.disposition,
                Disposition::RemoveInM1b { .. } | Disposition::Shadowed { .. }
            ) && id == format!("editor:{}:{}", r.source, r.key)
        })
    };
    for row in config_rows() {
        let field = row.pref_field.clone().unwrap_or_default();
        let Some(Resolution::Bound { chord }) = s.resolutions.get(&field) else {
            continue;
        };
        let cp = chord_platform(p);
        let def = if v >= 2 {
            &key_of(row, p).defaults.v2
        } else {
            &key_of(row, p).defaults.v1
        };
        let at_default = stored.get(&field).is_none_or(|x| {
            normalise_stored(x, cp) == normalise_stored(def.as_deref().unwrap_or(""), cp)
        });
        for ctx in available_contexts(row, p, v) {
            let got = s.owner_of(ctx, chord);
            // C17 is context priority, not a removed key: the applied table
            // command wins in TableS, while CodeMirror keeps multi-cursor
            // on the same chord outside the table.
            let c17_table_priority = v >= 2
                && at_default
                && ctx == OwnershipContext::TableS
                && matches!(
                    row.id.as_str(),
                    "table.insertRowAbove" | "table.insertRowBelow"
                )
                && got.as_deref()
                    == Some(if row.id == "table.insertRowAbove" {
                        "editor:codemirror:defaultKeymap:Mod-Alt-ArrowUp"
                    } else {
                        "editor:codemirror:defaultKeymap:Mod-Alt-ArrowDown"
                    });
            if c17_table_priority {
                continue;
            }
            // An implements binding present in today's v1 keymap is live.
            // A wrong owner must fail even on an otherwise default chord.
            let live_v1_winner = v < 2
                && at_default
                && layout().editor_owned.iter().any(|r| {
                    r.platforms.contains(&p)
                        && r.contexts.contains(&ctx)
                        && matches!(&r.disposition, Disposition::Implements { command } if command == &row.id)
                        && super::owners::keymap_name_to_stored(&r.key, cp).as_deref()
                            == Some(chord.as_str())
                });
            let live_v1_winner_loaded = s.hard.get(chord).is_some_and(|owners| {
                owners.iter().any(|owner| {
                    owner.id == row.id
                        && owner.except.as_deref() == Some(row.id.as_str())
                        && owner.contexts.contains(&ctx)
                })
            });
            let recognized_v1_owner =
                got.as_deref() == Some(row.id.as_str()) || got.as_deref().is_some_and(exempt);
            if live_v1_winner && (!live_v1_winner_loaded || !recognized_v1_owner) {
                out.push(format!(
                    "{p:?}@{v} {stored:?}: {field} {chord} in {ctx:?} -> {got:?}"
                ));
                continue;
            }
            if got.as_deref() == Some(row.id.as_str())
                || (at_default && (v < 2 || got.as_deref().is_some_and(exempt)))
            {
                continue;
            }
            out.push(format!(
                "{p:?}@{v} {stored:?}: {field} {chord} in {ctx:?} -> {got:?}"
            ));
        }
    }
}

#[test]
fn law_one_at_most_one_owner_over_the_single_custom_sweep() {
    let inputs = single_inputs(&sweep().pool);
    assert_eq!(inputs.len(), 58 * 19 * 3 * 2);
    let mut violations = Vec::new();
    for (p, v, stored) in &inputs {
        law_one(*p, *v, stored, &resolve(*p, *v, stored), &mut violations);
    }
    assert_eq!(
        violations.iter().take(10).collect::<Vec<_>>(),
        Vec::<&String>::new()
    );
}

#[test]
fn d255_live_v1_italic_collision_is_still_a_law_violation() {
    // Remove only this WI's winner from a cloned layout. The live v1 Mod-i
    // default then owns Source Italic's chord; the law must catch it.
    let mut without_source_italic = layout().clone();
    without_source_italic
        .editor_owned
        .retain(|r| !(r.source == "mdpro:sourceFormatPlugin" && r.key == "Mod-i"));
    let stored = Map::new();
    let state = resolve_with(
        &without_source_italic,
        Platform::Macos,
        1,
        &stored,
        &BTreeMap::new(),
    );
    let mut violations = Vec::new();
    law_one(Platform::Macos, 1, &stored, &state, &mut violations);
    assert!(violations
        .iter()
        .any(|v| v.contains("formatEmphasis Cmd+I in EditorS")));
}

#[test]
fn d255_live_v1_italic_rejects_an_unrelated_winning_owner() {
    let stored = Map::new();
    let mut state = resolve(Platform::Macos, 1, &stored);
    let mut hard = (*state.hard).clone();
    hard.entry("Cmd+I".into())
        .or_default()
        .push(super::owners::HardOwner {
            id: "intruder".into(),
            reason: SuppressReason::Fixed,
            precedence: 0,
            contexts: vec![OwnershipContext::EditorS],
            except: None,
        });
    state.hard = Arc::new(hard);
    let mut violations = Vec::new();
    law_one(Platform::Macos, 1, &stored, &state, &mut violations);
    assert!(violations
        .iter()
        .any(|v| v.contains("formatEmphasis Cmd+I in EditorS")));
}

#[test]
fn d255_d267_v2_only_chord_has_no_editor_owner_in_m1b() {
    let row = config_rows()
        .into_iter()
        .find(|r| r.id == "paragraph.codeFences")
        .expect("Code Fences row");
    assert_eq!(
        key_of(row, Platform::Windows).defaults.v1.as_deref(),
        Some("Cmd+Option+C")
    );
    assert_eq!(
        key_of(row, Platform::Windows).defaults.v2.as_deref(),
        Some("Cmd+Shift+K")
    );
    let d267 = layout()
        .editor_owned
        .iter()
        .find(|r| r.source == "codemirror:defaultKeymap" && r.key == "Shift-Mod-k")
        .expect("D267 inventory row");
    assert_eq!(d267.latent, None);
    assert!(matches!(&d267.disposition, Disposition::RemoveInM1b { id } if id == "D267"));
    let stored = Map::new();
    let mut violations = Vec::new();
    law_one(
        Platform::Windows,
        2,
        &stored,
        &resolve(Platform::Windows, 2, &stored),
        &mut violations,
    );
    assert!(violations
        .iter()
        .all(|v| !v.contains("paragraphCodeFences Cmd+Shift+K")));
}

#[test]
fn law_two_unassigning_never_unbinds_another_row() {
    let pool = sweep().pool;
    let mut bases: Vec<(Platform, u32, Map)> = Vec::new();
    for p in PLATFORMS {
        for v in VERSIONS {
            bases.push((p, v, Map::new()));
            for x in &pool {
                bases.push((p, v, Map::from([("fileSave".into(), x.clone())])));
                bases.push((p, v, Map::from([("fileNew".into(), x.clone())])));
            }
        }
    }
    assert_eq!(bases.len(), 234);
    let mut broken = Vec::new();
    for (p, v, stored) in &bases {
        let before = resolve(*p, *v, stored).resolutions;
        for f in fields() {
            let mut next = stored.clone();
            next.insert(f.clone(), "<unassigned>".into());
            let after = resolve(*p, *v, &next).resolutions;
            for (g, r) in &before {
                if *g != f && matches!(r, Resolution::Bound { .. }) && after.get(g) != Some(r) {
                    broken.push(format!("{p:?}@{v} {stored:?} -{f}: {g}"));
                }
            }
        }
    }
    assert_eq!(broken, Vec::<String>::new());
}

fn rewrite(stored: &Map, res: &BTreeMap<String, Resolution>) -> Map {
    let mut out = stored.clone();
    for (f, r) in res {
        if matches!(
            r,
            Resolution::Suppressed {
                reason: SuppressReason::YieldedToCustom,
                ..
            }
        ) {
            out.insert(f.clone(), "<unassigned>".into());
        }
    }
    out
}

fn bound(res: &BTreeMap<String, Resolution>) -> BTreeMap<String, Resolution> {
    res.iter()
        .filter(|(_, r)| matches!(r, Resolution::Bound { .. }))
        .map(|(f, r)| (f.clone(), r.clone()))
        .collect()
}

#[test]
fn law_three_the_m1b_rewrite_is_stable() {
    let (mut yields, mut broken) = (0, Vec::new());
    for (p, v, stored) in single_inputs(&sweep().pool) {
        let res = resolve(p, v, &stored).resolutions;
        let once = rewrite(&stored, &res);
        yields += usize::from(once.len() > stored.len());
        let res1 = resolve(p, v, &once).resolutions;
        let res2 = resolve(p, v, &rewrite(&once, &res1)).resolutions;
        let leftover = res1.values().any(|r| {
            matches!(
                r,
                Resolution::Suppressed {
                    reason: SuppressReason::YieldedToCustom,
                    ..
                }
            )
        });
        if bound(&res) != bound(&res1) || leftover || res2 != res1 {
            broken.push(format!("{p:?}@{v} {stored:?}"));
        }
    }
    assert!(yields >= 50, "{yields} yields");
    assert_eq!(broken, Vec::<String>::new());
}

#[test]
fn law_four_reversed_tables_change_no_resolution_and_no_owner() {
    let mut rev = layout().clone();
    rev.rows.reverse();
    rev.editor_owned.reverse();
    rev.reserved.macos.reverse();
    rev.reserved.windows.reverse();
    rev.reserved.linux.reverse();
    for case in fixture().cases {
        let (p, v, o) = (
            case.platform,
            case.defaults_version,
            &case.availability_override,
        );
        let a = resolve_with(layout(), p, v, &case.stored, o);
        let b = resolve_with(&rev, p, v, &case.stored, o);
        assert_eq!(a.resolutions, b.resolutions, "{}", case.name);
        for row in &case.owners {
            assert_eq!(
                a.owner_of(row.context, &row.chord),
                b.owner_of(row.context, &row.chord),
                "{}",
                case.name
            );
        }
        if case.name.starts_with("C09") || case.name.starts_with("C40") {
            let chord = if case.name.starts_with("C09") {
                "Cmd+Enter"
            } else {
                "Cmd+Backspace"
            };
            let got = b
                .owner_of(OwnershipContext::TableW, chord)
                .unwrap_or_default();
            assert!(
                got.starts_with("editor:milkdown:core/baseKeymap:"),
                "{}: {got}",
                case.name
            );
        }
    }
}
