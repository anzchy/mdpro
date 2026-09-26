//! Test-only helper: the exact-match retirement filter WI8-G applies to the
//! shipped-v1 round-trip diff (ADR-0039 retires `mcp.enabled`).
//!
//! Kept apart from the test files that specify it
//! (`preferences_retirement_tests.rs`, RET-04 / RET-05) so the specification
//! and the implementation are separate files.

/// Returns `missing` with order preserved, minus exactly the elements whose
/// path (`.0`) is string-equal to some `retired[i].0`.
pub(super) fn apply_retirements(
    missing: Vec<(String, String)>,
    retired: &[(&str, &str)],
) -> Vec<(String, String)> {
    missing
        .into_iter()
        .filter(|(path, _)| !retired.iter().any(|(r, _)| path == r))
        .collect()
}
