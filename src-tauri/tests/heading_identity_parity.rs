//! Shared heading-identity corpus — canonical (Rust) runner.
//!
//! Reads `tests/render-fixtures/heading-identity.json`, shared with
//! `tests/heading-identity-parity.test.ts`. The Rust renderer is not callable
//! from jsdom, so heading-identity parity is enforced as one fixture with two
//! independent runners — the same mechanism `render_golden.rs` already uses for
//! `phase1.json`.
//!
//! This file owns the `rust` face only: slug GENERATION on the canonical path
//! (`render_markdown` → `sanitize_html`). The JS runner owns the TOC and export
//! faces. See the fixture's `_doc` for the full face table.
//!
//! Each case's `expectedSlugs` is the CORRECT answer, not today's behavior. A
//! case that does not list `rust` in `currentlyFailsOn` must match it; a case
//! that does must NOT match — the defect is pinned as a defect, so the branch
//! stays green while the corpus still states the truth. WI-3.2 deletes the
//! `rust` entry it fixes and the assertion flips to demanding correctness.

use std::path::PathBuf;

use serde::Deserialize;
use tauri_app_lib::services::markdown::{render_markdown, sanitize_html};

const FACE: &str = "rust";

#[derive(Deserialize)]
struct Case {
    name: String,
    markdown: String,
    #[serde(rename = "expectedSlugs")]
    expected_slugs: Vec<String>,
    #[serde(default)]
    #[serde(rename = "currentlyFailsOn")]
    currently_fails_on: Vec<String>,
    #[serde(default)]
    note: String,
}

#[derive(Deserialize)]
struct Fixtures {
    cases: Vec<Case>,
}

fn load_fixtures() -> Fixtures {
    // CARGO_MANIFEST_DIR is src-tauri; the shared fixtures live one level up.
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop();
    path.push("tests/render-fixtures/heading-identity.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read fixtures at {path:?}: {e}"));
    serde_json::from_str(&raw).expect("heading-identity fixtures JSON parse")
}

/// Extract every `id="…"` value in document order from a rendered fragment.
fn heading_ids(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find(" id=\"") {
        rest = &rest[i + 5..];
        match rest.find('"') {
            Some(j) => {
                out.push(rest[..j].to_string());
                rest = &rest[j..];
            }
            None => break,
        }
    }
    out
}

#[test]
fn rust_face_matches_heading_identity_corpus() {
    let fixtures = load_fixtures();
    assert!(!fixtures.cases.is_empty(), "fixtures must not be empty");

    for case in fixtures.cases {
        let html = sanitize_html(&render_markdown(&case.markdown));
        let actual = heading_ids(&html);
        let pinned_defect = case.currently_fails_on.iter().any(|f| f == FACE);

        if pinned_defect {
            assert_ne!(
                actual, case.expected_slugs,
                "[{}] fixture pins `{FACE}` as DEFECTIVE, but it now produces the correct \
                 slugs. If WI-3.2 fixed this, delete \"{FACE}\" from that case's \
                 currentlyFailsOn.\n  note: {}\n--- rendered ---\n{html}",
                case.name, case.note
            );
        } else {
            assert_eq!(
                actual, case.expected_slugs,
                "[{}] `{FACE}` must produce the expected slugs.\n  note: {}\n\
                 --- rendered ---\n{html}",
                case.name, case.note
            );
        }
    }
}
