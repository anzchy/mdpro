//! M1A-WI-8 R1-3b: TS ⇄ Rust parity over the generated `sweep` section of
//! `tests/fixtures/binding-owner-cases.json` (written by
//! `tests/binding-conflicts.test.ts`). Every baseline must equal Rust's, and
//! every entry's diff against its baseline, `ownerOf` included, must equal
//! the diff Rust computes. Also holds the sweep's fixture types and the
//! helpers the law tests share. Mocked: nothing.
use super::tests::{chord_platform, fixture, layout, Map, Overrides, CONTEXTS, FIXTURE, PLATFORMS};
use super::*;
use crate::menu_layout::Disposition;
use crate::models::chord::normalise_stored;
use serde_json::Value;

pub(super) const VERSIONS: [u32; 2] = [1, 2];

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Sweep {
    #[serde(rename = "$generated")]
    _generated: String,
    pub(super) pool: Vec<String>,
    pub(super) contexts: Vec<OwnershipContext>,
    pub(super) baselines: BTreeMap<String, BTreeMap<String, Resolution>>,
    pub(super) entries: Vec<SweepEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SweepEntry {
    pub(super) platforms: Vec<Platform>,
    pub(super) v: Vec<u32>,
    pub(super) stored: Map,
    #[serde(default)]
    pub(super) availability_override: Overrides,
    pub(super) diff: SweepDiff,
}

#[derive(Debug, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SweepDiff {
    pub(super) fields: BTreeMap<String, Resolution>,
    pub(super) owners: BTreeMap<String, Vec<Option<String>>>,
}

pub(super) fn sweep() -> Sweep {
    let sweep = fixture().sweep;
    assert!(sweep.is_some(), "the fixture has no sweep section");
    sweep.unwrap_or_else(|| unreachable!())
}

pub(super) fn resolve(p: Platform, v: u32, stored: &Map) -> BindingState {
    resolve_with(layout(), p, v, stored, &Overrides::new())
}

fn name(p: Platform) -> &'static str {
    match p {
        Platform::Macos => "macos",
        Platform::Windows => "windows",
        Platform::Linux => "linux",
    }
}

fn diff_of(
    base: &BTreeMap<String, Resolution>,
    s: &BindingState,
    stored: &Map,
    p: Platform,
    ctx: &[OwnershipContext],
) -> SweepDiff {
    let fields = s
        .resolutions
        .iter()
        .filter(|(f, r)| base.get(*f) != Some(*r));
    let owners = stored
        .values()
        .filter(|x| normalise_stored(x, chord_platform(p)).is_some());
    SweepDiff {
        fields: fields.map(|(f, r)| (f.clone(), r.clone())).collect(),
        owners: owners
            .map(|x| (x.clone(), ctx.iter().map(|c| s.owner_of(*c, x)).collect()))
            .collect(),
    }
}

#[test]
fn sweep_baselines_and_every_entry_agree_with_rust() {
    let sweep = sweep();
    let raw: Value = serde_json::from_str(FIXTURE).unwrap_or(Value::Null);
    let raw_entries = raw["sweep"]["entries"].as_array().map_or(0, Vec::len);
    assert_eq!(sweep.baselines.len(), 6);
    assert_eq!(sweep.contexts, CONTEXTS.to_vec());
    let mut base = BTreeMap::new();
    for p in PLATFORMS {
        for v in VERSIONS {
            let key = format!("{}@{v}", name(p));
            let rust = resolve(p, v, &Map::new()).resolutions;
            assert_eq!(sweep.baselines.get(&key), Some(&rust), "baseline {key}");
            base.insert(key, rust);
        }
    }
    let (mut checked, mut failures) = (0, Vec::new());
    for e in &sweep.entries {
        for p in &e.platforms {
            for v in &e.v {
                let s = resolve_with(layout(), *p, *v, &e.stored, &e.availability_override);
                let b = base
                    .get(&format!("{}@{v}", name(*p)))
                    .cloned()
                    .unwrap_or_default();
                if diff_of(&b, &s, &e.stored, *p, &sweep.contexts) != e.diff {
                    failures.push(format!("{p:?}@{v} {:?}", e.stored));
                }
            }
        }
        checked += 1;
    }
    let first: Vec<&String> = failures.iter().take(10).collect();
    assert_eq!(first, Vec::<&String>::new(), "{} differ", failures.len());
    assert_eq!(checked, raw_entries);
    assert!(checked > 1000, "{checked} entries");
}

#[test]
fn sweep_has_an_entry_for_every_implements_row() {
    let sweep = sweep();
    for row in &layout().editor_owned {
        let Disposition::Implements { command } = &row.disposition else {
            continue;
        };
        for p in &row.platforms {
            let cp = chord_platform(*p);
            let Some(chord) = super::owners::keymap_name_to_stored(&row.key, cp) else {
                continue;
            };
            let hit = sweep.entries.iter().any(|e| {
                e.platforms.contains(p)
                    && ["fileSave", "fileNew"].iter().any(|t| {
                        let got = e.stored.get(*t).and_then(|x| normalise_stored(x, cp));
                        got.as_deref() == Some(chord.as_str())
                    })
            });
            assert!(hit, "{command} {} on {p:?}", row.key);
        }
    }
}
