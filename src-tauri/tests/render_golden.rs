//! Shared 4-surface golden-fixture suite — canonical (Rust) surface.
//!
//! Reads `tests/render-fixtures/phase1.json` (shared with the JS sanitizer
//! golden test) and runs each markdown case through the canonical render path
//! (`render_markdown` → `sanitize_html`), asserting the must-contain /
//! must-not-contain contract. A new syntax is "done" only when it passes here
//! AND on the JS surfaces. See plan decision A1.

use std::path::PathBuf;

use serde::Deserialize;
use tauri_app_lib::services::markdown::{render_markdown, sanitize_html};

#[derive(Deserialize)]
struct Case {
    name: String,
    markdown: String,
    #[serde(default)]
    #[serde(rename = "mustContain")]
    must_contain: Vec<String>,
    #[serde(default)]
    #[serde(rename = "mustNotContain")]
    must_not_contain: Vec<String>,
}

#[derive(Deserialize)]
struct Fixtures {
    cases: Vec<Case>,
}

fn load_fixtures() -> Fixtures {
    // CARGO_MANIFEST_DIR is src-tauri; the shared fixtures live one level up.
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop();
    path.push("tests/render-fixtures/phase1.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read fixtures at {path:?}: {e}"));
    serde_json::from_str(&raw).expect("fixtures JSON parse")
}

#[test]
fn canonical_surface_matches_golden_fixtures() {
    let fixtures = load_fixtures();
    assert!(!fixtures.cases.is_empty(), "fixtures must not be empty");

    for case in fixtures.cases {
        let html = sanitize_html(&render_markdown(&case.markdown));
        for needle in &case.must_contain {
            assert!(
                html.contains(needle.as_str()),
                "[{}] expected to contain {needle:?}\n--- rendered ---\n{html}",
                case.name
            );
        }
        for needle in &case.must_not_contain {
            assert!(
                !html.contains(needle.as_str()),
                "[{}] expected NOT to contain {needle:?}\n--- rendered ---\n{html}",
                case.name
            );
        }
    }
}
