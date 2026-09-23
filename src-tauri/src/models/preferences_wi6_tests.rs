//! WI-6 (ADR-0031 step 4) — `ViewMode` must accept `"source"`, the only
//! non-default value the TypeScript side can produce.
//!
//! Covers matrix cases WI6-A, WI6-B, WI6-C and WI6-D. The TS-union-vs-Rust-
//! variant parity assertion belongs to WI-8, not here.
//!
//! Sibling test module (rule 50 §6): `models/preferences.rs` is 753 lines —
//! already 2.5x over the 300-line budget — so these live in their own file
//! rather than as an inline `#[cfg(test)] mod tests`. Mirrors
//! `services/preferences_wi5_tests.rs`.
//!
//! **Why the wire form, not `assert_eq!` on values**: `ViewMode` derives no
//! `PartialEq`, and adding one *for a test* would be a test-shaped source
//! change. Comparing serialised strings is also the stronger claim — the
//! serialised contract is what actually crosses to TypeScript.

use super::*;
use crate::services::preferences::{merge_preferences, PartialPreferences};

/// The complete accepted domain. Changing this list is changing the IPC
/// contract with `src/types/preferences.ts`, and should be deliberate.
const ACCEPTED: [&str; 5] = ["split", "editor-only", "preview-only", "wysiwyg", "source"];

// ---------------------------------------------------------------------------
// WI6-B — Law: wire round trip over the whole accepted domain
// ---------------------------------------------------------------------------

/// For every `s` in the accepted set, `to_string(from_str(s)) == s`.
///
/// Catches an asymmetric rename (accepting `"source"` but emitting `"Source"`)
/// that a hand-written `Deserialize` impl would risk.
#[test]
fn wi6_b_every_accepted_wire_string_round_trips_unchanged() {
    for s in ACCEPTED {
        let quoted = format!("\"{s}\"");
        let parsed: ViewMode = serde_json::from_str(&quoted)
            .unwrap_or_else(|e| panic!("{quoted} must deserialise as a ViewMode, got {e}"));
        let reserialised = serde_json::to_string(&parsed).expect("ViewMode must serialise");
        assert_eq!(
            reserialised, quoted,
            "ViewMode wire round trip is asymmetric for {s}"
        );
    }
}

// ---------------------------------------------------------------------------
// WI6-C — the blast-radius case: an unknown variant voided the whole payload
// ---------------------------------------------------------------------------

/// `last_view_mode` is `Option<ViewMode>`, and serde does **not** map an
/// unknown variant to `None` — it fails the entire struct. So before the
/// `Source` variant existed, a `set_preferences` payload carrying
/// `lastViewMode: "source"` discarded `showSidebar` and `autoSaveInterval`
/// too. The two neighbour assertions are the load-bearing part of this test.
#[test]
fn wi6_c_unknown_last_view_mode_no_longer_voids_its_neighbours_in_the_payload() {
    let partial: PartialPreferences = serde_json::from_str(
        r#"{"lastViewMode":"source","showSidebar":false,"autoSaveInterval":444}"#,
    )
    .expect("a payload carrying lastViewMode:\"source\" must deserialise as a whole");

    let current = UserPreferences {
        show_sidebar: true,
        auto_save_interval: 30,
        ..Default::default()
    };
    let result = merge_preferences(current, partial);

    assert_eq!(
        serde_json::to_string(&result.last_view_mode).expect("ViewMode must serialise"),
        "\"source\"",
        "lastViewMode must survive the merge"
    );
    assert!(
        !result.show_sidebar,
        "showSidebar from the same payload must still be applied"
    );
    assert_eq!(
        result.auto_save_interval, 444,
        "autoSaveInterval from the same payload must still be applied"
    );
}

// ---------------------------------------------------------------------------
// WI6-D — the domain stays closed
// ---------------------------------------------------------------------------

/// The defect was that the domain was too *small*. An unbounded fix
/// (`#[serde(other)]`, an `alias`, a catch-all arm) would be a different and
/// worse bug: it would swallow a typo instead of reporting it.
///
/// `"Source"` and `"editorOnly"` are in this list on purpose — they are the
/// two shapes a careless `rename_all` change would start accepting, and
/// accepting them would mean the TS and Rust domains had diverged again.
#[test]
fn wi6_d_strings_outside_the_accepted_set_still_fail_to_deserialise() {
    for s in ["telepathy", "", "Source", "editorOnly", "split "] {
        let quoted = format!("\"{s}\"");
        let result: Result<ViewMode, _> = serde_json::from_str(&quoted);
        assert!(
            result.is_err(),
            "{quoted} must not deserialise as a ViewMode"
        );
    }
}

// ---------------------------------------------------------------------------
// WI6-A — every variant serialises to its exact kebab-case string
//
// Appended after WI6-B…D rather than placed first: B/C/D deserialise from
// strings and so compile against today's enum, which made a *runtime* red
// recordable. This case names `ViewMode::Source` and could therefore only
// fail to compile, which a receipt correctly refuses to accept as evidence.
// ---------------------------------------------------------------------------

/// Asserted as exact literals, deliberately not via a round trip: a round trip
/// is symmetric and would pass just as happily if `Source` had been added as
/// `"Source"` or `"src"`. This is the case that pins the wire spelling to the
/// TS union in `src/types/preferences.ts`.
#[test]
fn wi6_a_each_variant_serialises_to_its_exact_kebab_case_string() {
    assert_eq!(
        serde_json::to_string(&ViewMode::Split).expect("ViewMode must serialise"),
        "\"split\""
    );
    assert_eq!(
        serde_json::to_string(&ViewMode::EditorOnly).expect("ViewMode must serialise"),
        "\"editor-only\""
    );
    assert_eq!(
        serde_json::to_string(&ViewMode::PreviewOnly).expect("ViewMode must serialise"),
        "\"preview-only\""
    );
    assert_eq!(
        serde_json::to_string(&ViewMode::Wysiwyg).expect("ViewMode must serialise"),
        "\"wysiwyg\""
    );
    assert_eq!(
        serde_json::to_string(&ViewMode::Source).expect("ViewMode must serialise"),
        "\"source\""
    );
}
