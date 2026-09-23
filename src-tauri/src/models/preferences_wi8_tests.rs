//! WI-8 (ADR-0031 step 4) — the cross-language contract-parity fence, Rust half.
//!
//! Covers matrix cases WI8-A, WI8-B and WI8-G of
//! `.claude/tdd-guardian/tests-20260923-152800.md`.
//!
//! **Why this exists.** ADR-0031 declines `#[serde(deny_unknown_fields)]`, so
//! nothing in the *running* system will ever report a drift between the Rust
//! `UserPreferences` and the TypeScript `UserPreferences`. A field added to one
//! side is silently ignored by the other, and `#[serde(default)]` quietly
//! manufactures a replacement value. These tests are the only thing that will
//! ever say so.
//!
//! **The mechanism is the shared file, not the assertion.** Two independent
//! same-language round trips cannot detect cross-language disagreement — each
//! would be green while the two languages describe different documents. Both
//! lanes therefore read the *same* bytes:
//! `tests/fixtures/preferences-contract.json`. The TypeScript half is
//! `tests/preferences-contract-parity.test.ts` (WI8-C / WI8-D / WI8-F); the
//! shortcut-value half is `preferences_wi7_tests.rs::wi7_h_…`.
//!
//! Nothing is mocked: a real file, real serde. No case here touches `$HOME`,
//! writes a file, or needs `crate::HOME_LOCK` — every one of them reads a
//! fixture and compares `serde_json::Value`s.
//!
//! Sibling test module (rule 50 §6): `models/preferences.rs` is ~900 lines, so
//! these live in their own file, as `preferences_wi6_tests.rs` and
//! `preferences_wi7_tests.rs` do.

use super::*;
use serde_json::Value;

/// The living contract document. Edited in the same commit as any type change
/// on either side — that is the whole point of it.
const CONTRACT_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/preferences-contract.json"
);

/// The frozen witness for `config.json` files already on users' disks.
/// **Never edited in the same commit as a type change** — see WI8-G below and
/// the `$README` key inside the file itself.
const SHIPPED_V1_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/preferences-shipped-v1.json"
);

fn read_fixture(path: &str) -> Value {
    let text = std::fs::read_to_string(path);
    assert!(
        text.is_ok(),
        "the shared fixture must be readable at {path}: {:?}",
        text.as_ref().err()
    );
    let parsed = serde_json::from_str::<Value>(&text.unwrap());
    assert!(
        parsed.is_ok(),
        "the fixture at {path} must be valid JSON: {:?}",
        parsed.as_ref().err()
    );
    parsed.unwrap()
}

/// What a fixture-vs-round-trip comparison found, in three separable kinds so
/// each case can assert exactly the claim it makes.
#[derive(Default)]
struct Diff {
    /// `(path, fixture_value)` — present in the fixture, absent from the round
    /// trip. A field Rust *drops*.
    missing: Vec<(String, String)>,
    /// `(path, round_trip_value)` — present in the round trip, absent from the
    /// fixture. A field Rust has that nobody else was told about.
    extra: Vec<(String, String)>,
    /// `(path, fixture_value, round_trip_value)` — present on both sides with
    /// different values. This is what a `#[serde(skip_deserializing)]`, a
    /// coercing `deserialize_with`, or a truncating type change looks like:
    /// the key graph is untouched and the value is thrown away.
    differing: Vec<(String, String, String)>,
}

/// Recursively compares a fixture document against a round-tripped document,
/// by key **and** by leaf value, in both directions.
///
/// # The `$`-prefix rule (stated identically on the TypeScript recursion in
/// `tests/preferences-contract-parity.test.ts`)
///
/// A **top-level** key whose name begins with `$` is a *sibling annotation
/// block*, not part of the contract document: `$acceptedViewModes` (WI8-B /
/// WI8-D), `$defaultKeyboardShortcuts` (WI7-H / WI8-F), `$README`. No
/// recursion descends into them and no direction of the comparison reports
/// them. One stated rule, rather than a list of names nobody remembers.
///
/// # What counts as a leaf
///
/// Anything that is not a JSON object: scalars, `null`, and **arrays compared
/// whole** (`recentFiles` is a single leaf — the alternative rots on element
/// count for no gain).
///
/// # `windowStates`
///
/// Deliberately *not* special-cased here. It is an open-ended
/// `Record<String, WindowGeometry>`, and the matrix's "do not descend into its
/// keys" rule exists for the **TypeScript** comparison, where the other side
/// (`DEFAULT_PREFERENCES.windowStates`) is `{}` and has no entry to compare
/// against. On this side both documents are the *same* document round-tripped,
/// so the user path `"/tmp/contract.md"` is present on both sides by
/// construction and descending into it is strictly stronger: it proves
/// `WindowGeometry`'s five values survive the trip.
fn diff_documents(fixture: &Value, round_trip: &Value) -> Diff {
    let mut diff = Diff::default();
    walk(fixture, round_trip, "", true, &mut diff);
    diff
}

fn walk(fixture: &Value, round_trip: &Value, path: &str, top_level: bool, diff: &mut Diff) {
    match (fixture, round_trip) {
        (Value::Object(f), Value::Object(r)) => {
            for (key, fixture_value) in f {
                if top_level && key.starts_with('$') {
                    continue;
                }
                let child = join_path(path, key);
                match r.get(key) {
                    Some(round_trip_value) => {
                        walk(fixture_value, round_trip_value, &child, false, diff);
                    }
                    None => diff.missing.push((child, fixture_value.to_string())),
                }
            }
            for (key, round_trip_value) in r {
                if top_level && key.starts_with('$') {
                    continue;
                }
                if !f.contains_key(key) {
                    diff.extra
                        .push((join_path(path, key), round_trip_value.to_string()));
                }
            }
        }
        _ => {
            // Leaf, or a shape disagreement (object on one side, scalar on the
            // other). Both are reported the same way: the value changed.
            if fixture != round_trip {
                diff.differing.push((
                    path.to_string(),
                    fixture.to_string(),
                    round_trip.to_string(),
                ));
            }
        }
    }
}

fn join_path(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_string()
    } else {
        format!("{path}.{key}")
    }
}

/// WI8-A — **Law**: a Rust deserialise → re-serialise preserves the fixture's
/// key graph **and** every leaf value, in both directions.
///
/// Both directions are asserted deliberately:
///
/// - *fixture minus round trip* catches a field Rust **drops** — the
///   `markdown.autoReformatTablesOnSave` / `keyboardShortcuts.viewSource` /
///   `keyboardShortcuts.viewWysiwyg` case WI-5 fixed.
/// - *round trip minus fixture* catches a field Rust has that nobody else knows
///   about — which is exactly the `fileOpenQuickly` situation that produced
///   this whole ADR step. The plan specified only the first direction; the
///   second is what makes WI-8 catch the drift it was created by.
///
/// The **leaf-value** comparison is not redundant with the key comparison: a
/// `#[serde(skip_deserializing)]` field still *serialises*, so both key-set
/// directions pass while the user's value is discarded. The fixture's "every
/// value non-default" design constraint exists precisely so a discarded value
/// cannot coincide with the default that replaces it.
#[test]
fn wi8_a_rust_round_trip_preserves_the_contract_fixture_key_graph_and_values() {
    let fixture = read_fixture(CONTRACT_FIXTURE);

    let parsed = serde_json::from_value::<UserPreferences>(fixture.clone());
    assert!(
        parsed.is_ok(),
        "the contract fixture must deserialise as a complete UserPreferences \
         document; serde said: {:?}",
        parsed.as_ref().err()
    );
    let round_trip = serde_json::to_value(parsed.unwrap())
        .expect("a UserPreferences always serialises to a JSON object");

    let diff = diff_documents(&fixture, &round_trip);

    let dropped: Vec<String> = diff
        .missing
        .iter()
        .map(|(path, value)| format!("field dropped at {path}: fixture={value}"))
        .collect();
    let unknown: Vec<String> = diff
        .extra
        .iter()
        .map(|(path, value)| format!("field unknown to the fixture at {path}: rust={value}"))
        .collect();
    let changed: Vec<String> = diff
        .differing
        .iter()
        .map(|(path, f, r)| format!("value dropped at {path}: fixture={f}, rust={r}"))
        .collect();

    assert!(
        dropped.is_empty() && unknown.is_empty() && changed.is_empty(),
        "the Rust UserPreferences and tests/fixtures/preferences-contract.json \
         describe different documents:\n  {}\n  {}\n  {}",
        dropped.join("\n  "),
        unknown.join("\n  "),
        changed.join("\n  ")
    );
}

/// WI8-B — every accepted view-mode string the fixture declares deserialises as
/// a Rust `ViewMode`, and the fixture does not contradict its own declared
/// domain.
///
/// `ViewMode` derives no `PartialEq` (and this test does not ask for one), so
/// the claim is made on the wire form: `from_str` succeeds.
#[test]
fn wi8_b_every_accepted_view_mode_in_the_fixture_deserialises_as_a_rust_view_mode() {
    let fixture = read_fixture(CONTRACT_FIXTURE);

    let accepted = fixture.get("$acceptedViewModes").and_then(Value::as_array);
    assert!(
        accepted.is_some(),
        "the contract fixture must declare a $acceptedViewModes array — it is \
         the shared domain both languages are held to"
    );
    let accepted = accepted.unwrap();
    assert!(
        !accepted.is_empty(),
        "$acceptedViewModes must not be empty; an empty domain makes this case vacuous"
    );

    let mut rejected: Vec<String> = Vec::new();
    let mut members: Vec<&str> = Vec::new();
    for entry in accepted {
        let Some(name) = entry.as_str() else {
            rejected.push(format!("{entry} is not a string"));
            continue;
        };
        members.push(name);
        if let Err(error) = serde_json::from_str::<ViewMode>(&format!("\"{name}\"")) {
            rejected.push(format!("{name:?} is not a Rust ViewMode: {error}"));
        }
    }
    assert!(
        rejected.is_empty(),
        "the Rust ViewMode enum does not accept every value the contract \
         fixture declares: {}",
        rejected.join("; ")
    );

    // The fixture must not contradict its own declared domain — a fixture that
    // does is worse than no fixture, because both consumers would be green.
    for position in ["lastViewMode", "defaultViewMode"] {
        let value = fixture.get(position).and_then(Value::as_str);
        assert!(
            value.is_some(),
            "the contract fixture must carry a string at {position}"
        );
        let value = value.unwrap();
        assert!(
            members.contains(&value),
            "the fixture's {position} is {value:?}, which is not in its own \
             $acceptedViewModes list {members:?}"
        );
    }
}

/// WI8-G — **Law**: a `config.json` a shipped build wrote loses no value.
///
/// # Why this is not the same test as WI8-A
///
/// WI8-A holds the two *in-repo* types to one document, and a **coordinated**
/// rename — the Rust `#[serde(rename)]`, `src/types/preferences.ts`, and the
/// contract fixture all changed in one commit — is green across it, WI8-C,
/// WI8-F and WI7-H. That is accepted: two types that agree do satisfy the
/// bijection law. What is *not* accepted is that same rename silently
/// discarding data from the files already on disk. ADR-0031 declines
/// `deny_unknown_fields`, so a renamed key in a real user's file is ignored,
/// `#[serde(default)]` supplies a replacement, and the user's value is
/// destroyed with no error raised at any layer. This is the witness for that
/// third party, and it is the one fixture an author cannot edit to get green.
///
/// # Why `extra` is tolerated here and not in WI8-A
///
/// The frozen fixture records a *past* format. Adding a field to
/// `UserPreferences` is legitimate and must not turn this red — if it did, the
/// only way back to green would be editing the frozen file, which destroys the
/// witness. Only the two directions that mean **data loss** are asserted:
/// a path in the shipped file that the round trip has lost, and a path whose
/// value the round trip changed.
///
/// Green on day one, by construction — it is a snapshot of today's format.
/// Its non-vacuity is established by WI8-E's third probe (rename a wire key in
/// `models/preferences.rs`), recorded in the green receipt.
#[test]
fn wi8_g_a_shipped_config_json_loses_no_value_through_the_current_types() {
    let shipped = read_fixture(SHIPPED_V1_FIXTURE);

    let parsed = serde_json::from_value::<UserPreferences>(shipped.clone());
    assert!(
        parsed.is_ok(),
        "a config.json a shipped build wrote must still deserialise; serde said: {:?}",
        parsed.as_ref().err()
    );
    let round_trip = serde_json::to_value(parsed.unwrap())
        .expect("a UserPreferences always serialises to a JSON object");

    let diff = diff_documents(&shipped, &round_trip);

    // `rustfmt::skip`: these exact lines were fingerprinted by the WI-8 red
    // receipt (`ADR31-WI-8`). rustfmt would rewrap the `.chain(…)` closure,
    // which the receipt reads as the implementation having edited its own
    // acceptance criteria. The wrapping is held so the receipt can tell the
    // truth; nothing about the assertion changes either way.
    #[rustfmt::skip]
    let lost: Vec<String> = diff
        .missing
        .iter()
        .map(|(path, value)| format!("a shipped config.json would lose {path}: was {value}"))
        .chain(
            diff.differing.iter().map(|(path, was, became)| {
                format!("a shipped config.json would lose {path}: was {was}, became {became}")
            }),
        )
        .collect();

    assert!(
        lost.is_empty(),
        "the current types silently discard data from a config.json that a \
         shipped build wrote. Fix with a #[serde(alias = \"oldName\")] or a \
         written migration — do NOT regenerate \
         tests/fixtures/preferences-shipped-v1.json, which is the only witness \
         for the files already on disk:\n  {}",
        lost.join("\n  ")
    );
}
