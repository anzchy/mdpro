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
//! case that does not list `rust` in `currentlyFailsOn` must match it. A case
//! that DOES must match `currentlyProduces["rust"]` exactly — the output
//! measured from the live code — and that recording must itself still differ
//! from `expectedSlugs`.
//!
//! Asserting only `actual != expected` for a pinned defect would accept every
//! wrong answer equally, so a known-defective case could be corrupted further
//! (or emptied outright) while staying green. Pinning the exact output makes
//! the defect a specific, described defect rather than "anything but correct".
//! WI-3.2 deletes the `rust` entry from `currentlyFailsOn` AND from
//! `currentlyProduces`, and the assertion flips to demanding correctness.

use std::collections::HashMap;
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
    /// Per-face recording of today's output. Values are `Value` rather than
    /// `Vec<String>` because the `tocOffsets` face records numbers; only the
    /// `rust` entry is ever read here, and it is converted on use.
    #[serde(default)]
    #[serde(rename = "currentlyProduces")]
    currently_produces: HashMap<String, serde_json::Value>,
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

/// Extract the `id` of every `<h1>`–`<h6>` in document order.
///
/// Deliberately NOT every `id` in the fragment. Footnote references and
/// definitions carry ids of their own (`fnref-NAME` and `NAME`), and raw HTML
/// passes arbitrary ids through the sanitizer, so a whole-document sweep
/// reports a perfectly valid document as having extra headings — the
/// `non-heading-ids` case measures exactly that. A sweep is equally blind in
/// the other direction: an `id` MOVED off a heading onto a wrapper still shows
/// up, so the anchor silently stops being a heading anchor with no test failing.
///
/// Reads ` id="` with its leading space so `data-heading-id="…"` is never
/// mistaken for an anchor — a heading that kept only the data attribute (what
/// DOMPurify's clobbering defense leaves behind) correctly contributes nothing.
fn heading_ids(html: &str) -> Vec<String> {
    let bytes = html.as_bytes();
    let mut out = Vec::new();
    let mut cursor = 0usize;

    while let Some(rel) = html[cursor..].find("<h") {
        // Index of the character after `<h`; always an ASCII boundary.
        let level_idx = cursor + rel + 2;
        cursor = level_idx;

        // `<h` opens a heading only when followed by a level digit 1–6.
        match bytes.get(level_idx) {
            Some(b'1'..=b'6') => {}
            Some(_) => continue,
            None => break,
        }

        // Attributes are read from the open tag only, which ends at the first `>`.
        let Some(end_rel) = html[level_idx..].find('>') else {
            break;
        };
        let tag = &html[level_idx..level_idx + end_rel];
        cursor = level_idx + end_rel;

        const ID_ATTR: &str = " id=\"";
        if let Some(at) = tag.find(ID_ATTR) {
            let after = &tag[at + ID_ATTR.len()..];
            if let Some(quote) = after.find('"') {
                out.push(after[..quote].to_string());
            }
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
            let raw = case.currently_produces.get(FACE).unwrap_or_else(|| {
                panic!(
                    "[{}] pins `{FACE}` in currentlyFailsOn but records no \
                     currentlyProduces[\"{FACE}\"]. A pinned defect must record the exact \
                     output it produces today, or the pin accepts any wrong answer at all.",
                    case.name
                )
            });
            let recorded: Vec<String> = serde_json::from_value(raw.clone()).unwrap_or_else(|e| {
                panic!(
                    "[{}] currentlyProduces[\"{FACE}\"] must be an array of strings: {e}",
                    case.name
                )
            });

            assert_ne!(
                recorded, case.expected_slugs,
                "[{}] currentlyProduces[\"{FACE}\"] equals expectedSlugs, so the recorded \
                 'defect' IS the correct answer. Delete \"{FACE}\" from currentlyFailsOn and \
                 from currentlyProduces.\n  note: {}",
                case.name, case.note
            );
            assert_eq!(
                actual, recorded,
                "[{}] `{FACE}` is pinned as DEFECTIVE with a recorded output, but it now \
                 produces something else. If WI-3.2 fixed it, delete \"{FACE}\" from \
                 currentlyFailsOn and currentlyProduces; if the behavior merely changed, \
                 re-measure and update the recording.\n  note: {}\n--- rendered ---\n{html}",
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
