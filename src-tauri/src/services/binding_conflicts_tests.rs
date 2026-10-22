//! M1A-WI-8: the Rust twin of `tests/binding-conflicts.test.ts`. Runs every
//! `cases` row of `tests/fixtures/binding-owner-cases.json` against the real
//! `menu_layout()` (expect, owners, locality), the strict-loader checks
//! (R1-13a), the raw assertion count (R1-13b), the baseline ownership of the
//! probe chords and the all-defaults-v2 case. The sweep parity (R1-3b) is in
//! `binding_conflicts_sweep_tests.rs`, the laws in `binding_conflicts_law_tests.rs`.
//! Mocked: nothing.
use super::*;
use crate::menu_layout::menu_layout;
use crate::models::chord::{normalise_stored, Platform as ChordPlatform};
use serde_json::Value;

pub(super) const FIXTURE: &str = include_str!("../../../tests/fixtures/binding-owner-cases.json");
pub(super) const PLATFORMS: [Platform; 3] = [Platform::Macos, Platform::Windows, Platform::Linux];
pub(super) const CONTEXTS: [OwnershipContext; 7] = [
    OwnershipContext::EditorW,
    OwnershipContext::EditorS,
    OwnershipContext::TableW,
    OwnershipContext::TableS,
    OwnershipContext::Modal,
    OwnershipContext::Recorder,
    OwnershipContext::NativeFocus,
];

#[test]
fn image_conflict_resolution_matches_shared_parity_fixture() {
    let cases: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/legacy-image-shortcut-cases.json"
    ))
    .expect("image parity fixture");
    assert!(cases.len() >= 6);
    for case in cases {
        let platform: Platform =
            serde_json::from_value(case["platform"].clone()).expect("platform");
        let stored = case["stored"].as_str().expect("stored");
        let expected = case["expected"].as_str().expect("expected");
        let input = Map::from([("formatImage".to_string(), stored.to_string())]);
        let result = resolve_with(layout(), platform, 1, &input, &Overrides::new());
        let got = serde_json::to_value(result.resolutions.get("formatImage"))
            .expect("resolution serializes");
        let want = if expected == "<unassigned>" {
            serde_json::json!({"kind":"unassigned"})
        } else {
            serde_json::json!({"kind":"bound","chord":expected})
        };
        assert_eq!(got, want, "{platform:?} stored {stored:?}");
    }
}
pub(super) type Map = BTreeMap<String, String>;
pub(super) type Overrides = BTreeMap<String, Availability>;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Fixture {
    #[serde(rename = "$comment")]
    _comment: Option<String>,
    #[serde(rename = "parse")]
    _parse: Value,
    pub(super) cases: Vec<Case>,
    pub(super) sweep: Option<super::sweep_tests::Sweep>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Case {
    pub(super) name: String,
    pub(super) platform: Platform,
    pub(super) defaults_version: u32,
    #[serde(default)]
    pub(super) availability_override: Overrides,
    pub(super) stored: Map,
    pub(super) expect: BTreeMap<String, Resolution>,
    pub(super) owners: Vec<OwnerRow>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct OwnerRow {
    pub(super) context: OwnershipContext,
    pub(super) chord: String,
    pub(super) owner: Option<String>,
}

pub(super) fn load(text: &str) -> Result<Fixture, String> {
    serde_json::from_str(text).map_err(|e| e.to_string())
}

pub(super) fn fixture() -> Fixture {
    load(FIXTURE).unwrap_or_else(|e| panic!("fixture loads: {e}"))
}

pub(super) fn layout() -> &'static MenuLayout {
    menu_layout().unwrap_or_else(|e| panic!("layout parses: {e}"))
}

pub(super) fn chord_platform(p: Platform) -> ChordPlatform {
    match p {
        Platform::Macos => ChordPlatform::Macos,
        Platform::Windows => ChordPlatform::Windows,
        Platform::Linux => ChordPlatform::Linux,
    }
}

pub(super) fn state(case: &Case) -> BindingState {
    let (p, v) = (case.platform, case.defaults_version);
    resolve_with(layout(), p, v, &case.stored, &case.availability_override)
}

fn norm_default(field: &str, p: Platform, v: u32) -> Option<String> {
    let row = layout()
        .rows
        .iter()
        .find(|r| r.pref_field.as_deref() == Some(field))?;
    let key = match p {
        Platform::Macos => &row.key.macos,
        Platform::Windows => &row.key.windows,
        Platform::Linux => &row.key.linux,
    };
    let d = if v >= 2 {
        &key.defaults.v2
    } else {
        &key.defaults.v1
    };
    normalise_stored(d.as_deref()?, chord_platform(p))
}

#[test]
fn strict_loader_accepts_the_fixture_and_rejects_three_mutations() {
    assert!(fixture().cases.len() >= 46);
    let mut extra: Value = serde_json::from_str(FIXTURE).unwrap_or(Value::Null);
    extra["cases"][0]["extra"] = Value::from(1);
    assert!(load(&extra.to_string()).is_err(), "extra key in a case");
    let mut res: Value = serde_json::from_str(FIXTURE).unwrap_or(Value::Null);
    res["cases"][0]["expect"]["fileSave"]["x"] = Value::from(1);
    assert!(load(&res.to_string()).is_err(), "extra key in a Resolution");
    let mut typo: Value = serde_json::from_str(FIXTURE).unwrap_or(Value::Null);
    let expect = typo["cases"][0]["expect"].take();
    if let Some(case) = typo["cases"][0].as_object_mut() {
        case.remove("expect");
        case.insert("expcet".into(), expect);
    }
    assert!(load(&typo.to_string()).is_err(), "expect misspelt");
}

#[test]
fn guards_46_cases_three_platforms_eight_reasons() {
    let cases = fixture().cases;
    assert!(cases.len() >= 46, "{} cases", cases.len());
    for p in PLATFORMS {
        assert!(cases.iter().any(|c| c.platform == p), "{p:?} missing");
    }
    let mut reasons: Vec<SuppressReason> = cases
        .iter()
        .flat_map(|c| c.expect.values())
        .filter_map(|r| match r {
            Resolution::Suppressed { reason, .. } => Some(*reason),
            Resolution::Bound { .. } | Resolution::Unassigned {} | Resolution::System {} => None,
        })
        .collect();
    reasons.sort();
    reasons.dedup();
    assert_eq!(reasons.len(), 9, "{reasons:?}");
}

#[test]
fn every_case_resolves_as_the_fixture_says() {
    let raw: Value = serde_json::from_str(FIXTURE).unwrap_or(Value::Null);
    let raw_count: usize = raw["cases"]
        .as_array()
        .map(|cs| {
            cs.iter()
                .map(|c| {
                    let e = c["expect"].as_object().map_or(0, |o| o.len());
                    e + c["owners"].as_array().map_or(0, Vec::len) + 1
                })
                .sum()
        })
        .unwrap_or(0);
    let mut executed = 0;
    let mut failures = Vec::new();
    for case in fixture().cases {
        let s = state(&case);
        for (field, want) in &case.expect {
            if s.resolutions.get(field) != Some(want) {
                failures.push(format!(
                    "{}: {field} = {:?}",
                    case.name,
                    s.resolutions.get(field)
                ));
            }
            executed += 1;
        }
        for o in &case.owners {
            let got = s.owner_of(o.context, &o.chord);
            if got != o.owner {
                failures.push(format!(
                    "{}: owner {:?} {} = {got:?}",
                    case.name, o.context, o.chord
                ));
            }
            executed += 1;
        }
        let empty = Map::new();
        let base = resolve_with(
            layout(),
            case.platform,
            case.defaults_version,
            &empty,
            &Overrides::new(),
        );
        let cp = chord_platform(case.platform);
        let mentioned: Vec<Option<String>> = case
            .stored
            .values()
            .map(|s| normalise_stored(s, cp))
            .collect();
        let local: Vec<&String> = base
            .resolutions
            .keys()
            .filter(|f| {
                !case.stored.contains_key(*f) && !case.availability_override.contains_key(*f)
            })
            .filter(|f| !mentioned.contains(&norm_default(f, case.platform, case.defaults_version)))
            .collect();
        assert!(
            local.len() > 40,
            "{}: locality domain {}",
            case.name,
            local.len()
        );
        for f in local {
            if s.resolutions.get(f) != base.resolutions.get(f) {
                failures.push(format!("{}: locality broken for {f}", case.name));
            }
        }
        executed += 1;
    }
    assert_eq!(failures, Vec::<String>::new());
    assert_eq!(executed, raw_count);
}

#[test]
fn baseline_owners_of_the_probe_chords() {
    let core_enter = "editor:milkdown:core/baseKeymap:Mod-Enter";
    let cm_enter = "editor:codemirror:defaultKeymap:Mod-Enter";
    let g = "editor:codemirror:searchKeymap:Mod-Alt-g";
    let core_e = "editor:milkdown:core/baseKeymap:Ctrl-e";
    let cm_e = "editor:codemirror:defaultKeymap:Ctrl-e";
    let probes: [(Platform, u32, &str, [Option<&str>; 4]); 6] = [
        (Platform::Macos, 1, "Cmd+J", [None; 4]),
        (Platform::Macos, 2, "Cmd+J", [None; 4]),
        (
            Platform::Macos,
            2,
            "Cmd+Option+G",
            [None, Some(g), None, Some(g)],
        ),
        (
            Platform::Macos,
            2,
            "Cmd+Enter",
            [
                Some(core_enter),
                Some(cm_enter),
                Some(core_enter),
                Some(cm_enter),
            ],
        ),
        (
            Platform::Macos,
            2,
            "Ctrl+E",
            [Some(core_e), Some(cm_e), Some(core_e), Some(cm_e)],
        ),
        (Platform::Linux, 2, "Option+D", [None; 4]),
    ];
    for (p, v, chord, want) in probes {
        let s = resolve_with(layout(), p, v, &Map::new(), &Overrides::new());
        let got: Vec<Option<String>> = CONTEXTS.iter().map(|c| s.owner_of(*c, chord)).collect();
        let mut expected: Vec<Option<String>> = want.iter().map(|o| o.map(String::from)).collect();
        expected.extend([None, None, None]);
        assert_eq!(got, expected, "{p:?} v{v} {chord}");
    }
}

#[test]
fn all_defaults_v2_bind_every_available_row_and_flag_nothing() {
    for p in PLATFORMS {
        let res = resolve_bindings(p, 2, &Map::new()).unwrap_or_default();
        assert_eq!(res.len(), 58, "{p:?}");
        for row in layout().rows.iter() {
            let Some(field) = row.pref_field.as_deref() else {
                continue;
            };
            let (key, avail) = match p {
                Platform::Macos => (&row.key.macos, row.availability.macos.v2),
                Platform::Windows => (&row.key.windows, row.availability.windows.v2),
                Platform::Linux => (&row.key.linux, row.availability.linux.v2),
            };
            let want = match (key.defaults.v2.as_deref(), avail) {
                (Some("<unassigned>"), _) => Resolution::Unassigned {},
                (Some("<system>"), _) => Resolution::System {},
                (_, Availability::None) => Resolution::Suppressed {
                    reason: SuppressReason::Unavailable,
                    conflicts_with: vec![],
                    flagged: false,
                },
                (_, Availability::Both | Availability::W | Availability::S) => Resolution::Bound {
                    chord: norm_default(field, p, 2).unwrap_or_default(),
                },
            };
            assert_eq!(res.get(field), Some(&want), "{p:?} {field}");
        }
    }
}
