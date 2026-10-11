//! ADR-0039 WI-2 — the retirement exemption WI8-G applies is exact, non-vacuous,
//! and exempts only what it names.
//!
//! Covers matrix cases RET-03, RET-04 and RET-05 of
//! `.claude/tdd-guardian/tests-20260926-235500.md`. RET-03 is the migration
//! guard for WI8-G (`preferences_wi8_tests.rs`); it lives here rather than in
//! that file to keep it near the 300-line budget (rule 50 §6).

use super::preferences_retirement::apply_retirements;
use super::preferences_wi8_tests::{
    diff_documents, read_fixture, RETIRED_PATHS, SHIPPED_V1_FIXTURE,
};
use super::*;

fn owned(rows: &[(&str, &str)]) -> Vec<(String, String)> {
    rows.iter()
        .map(|(p, v)| (p.to_string(), v.to_string()))
        .collect()
}

/// RET-03 — every retired path (a) existed in the shipped-v1 witness, (b) is
/// absent from the current round trip of it, and (c) with the list applied,
/// the shipped round trip loses nothing else.
#[test]
fn wi8_h_every_retired_path_existed_in_the_shipped_format_and_is_really_gone() {
    assert!(
        !RETIRED_PATHS.is_empty(),
        "an empty retirement list makes this vacuous"
    );
    let shipped = read_fixture(SHIPPED_V1_FIXTURE);
    let parsed = serde_json::from_value::<UserPreferences>(shipped.clone());
    assert!(parsed.is_ok(), "{:?}", parsed.as_ref().err());
    let round_trip = serde_json::to_value(parsed.unwrap()).unwrap();

    for (path, record) in RETIRED_PATHS {
        let pointer = format!("/{}", path.replace('.', "/"));
        assert!(
            shipped.pointer(&pointer).is_some(),
            "{path} ({record}) is retired but never existed in the shipped format"
        );
        assert!(
            round_trip.pointer(&pointer).is_none(),
            "{path} ({record}) is exempted but still round-trips: retirement not done"
        );
    }

    let diff = diff_documents(&shipped, &round_trip);
    let missing = apply_retirements(diff.missing, RETIRED_PATHS);
    assert!(
        missing.is_empty(),
        "lost beyond the retirement list: {missing:?}"
    );
    assert!(
        diff.differing.is_empty(),
        "values changed: {:?}",
        diff.differing
    );
}

/// RET-04 — a group-level retirement exempts only that exact path, never the
/// paths under it, and no prefix/suffix/substring relation removes anything.
#[test]
fn ret_04_retirement_is_exact_match_never_prefix_suffix_or_substring() {
    let b_missing = [
        ("mcp.enabled", "v"),
        ("mcp.enabledX", "v"),
        ("mcp", "v"),
        ("xmcp.enabled", "v"),
    ];
    type Pairs<'a> = &'a [(&'a str, &'a str)];
    let rows: [(Pairs, Pairs, Pairs); 3] = [
        (
            &[
                ("mcp", "v"),
                ("mcp.startOnLaunch", "v"),
                ("mcp.enabledX", "v"),
            ],
            &[("mcp", "t")],
            &[("mcp.startOnLaunch", "v"), ("mcp.enabledX", "v")],
        ),
        (
            &b_missing,
            &[("mcp.enabled", "ADR-0039")],
            &[("mcp.enabledX", "v"), ("mcp", "v"), ("xmcp.enabled", "v")],
        ),
        (&b_missing, &[], &b_missing),
    ];
    for (i, (missing, retired, want)) in rows.iter().enumerate() {
        assert_eq!(
            apply_retirements(owned(missing), retired),
            owned(want),
            "row {i}"
        );
    }
}

/// RET-05 — **Law** (exact-match partition) over all 32 subsets of a 5-path
/// universe × 4 retirement lists: (i) the output is a subsequence of the
/// input; (ii) every removed path equals a retired path; (iii) every input
/// path equal to a retired path is removed.
#[test]
fn ret_05_apply_retirements_is_an_exact_match_partition() {
    const UNIVERSE: [&str; 5] = [
        "mcp",
        "mcp.enabled",
        "mcp.enabledX",
        "mcp.startOnLaunch",
        "xmcp.enabled",
    ];
    let lists: [&[(&str, &str)]; 4] = [
        &[],
        &[("mcp", "t")],
        &[("mcp.enabled", "t")],
        &[("mcp", "t"), ("mcp.startOnLaunch", "t")],
    ];
    let mut failures: Vec<String> = Vec::new();
    for mask in 0u32..32 {
        let input: Vec<(String, String)> = UNIVERSE
            .iter()
            .enumerate()
            .filter(|(i, _)| mask & (1 << i) != 0)
            .map(|(_, p)| (p.to_string(), "v".to_string()))
            .collect();
        for retired in lists {
            let output = apply_retirements(input.clone(), retired);
            let is_retired = |p: &str| retired.iter().any(|(r, _)| *r == p);

            // (i) subsequence: every output element is matched, in order.
            let mut j = 0;
            for item in &input {
                if j < output.len() && output[j] == *item {
                    j += 1;
                }
            }
            if j != output.len() {
                failures.push(format!("(i) {input:?} / {retired:?} -> {output:?}"));
            }
            for item in &input {
                let kept = output.contains(item);
                // (ii) removed ⇒ retired.
                if !kept && !is_retired(&item.0) {
                    failures.push(format!("(ii) {} removed / {retired:?}", item.0));
                }
                // (iii) retired ⇒ removed.
                if kept && is_retired(&item.0) {
                    failures.push(format!("(iii) {} kept / {retired:?}", item.0));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
