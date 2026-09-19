//! WI-3.2 — behavioural tests for the `rust` slug face
//! (`src-tauri/src/services/markdown.rs` `generate_heading_id`, reached through the
//! public `render_markdown`).
//!
//! PARITY SURFACE — THREE LIVE FACES OWNED BY mdpro, and they are not every face in
//! the running app:
//!   1. `rust`           this file / `markdown.rs::generate_heading_id`
//!   2. `toc`            `src/services/tocService.ts` `parseHeadingsFromContent`
//!   3. `exportFallback` `src/services/exportService.ts` `renderMarkdown` (IPC rejecting)
//!
//! A FOURTH LIVE FACE exists on the WYSIWYG surface: the heading DOM ids
//! `@milkdown/preset-commonmark@7.18.0` writes — `defaultHeadingIdGenerator`
//! (`lib/index.js:521-523`, punctuation preserved) composed with
//! `syncHeadingIdPlugin`'s own `-#n` dedupe (`:2119-2161`). Measured, do not
//! re-derive: the two dedupe schemes disagree (`intro-#2` there, `intro-1` here),
//! empty headings get no `id` at all, and the ids are rewritten by a dispatched
//! transaction on every doc change. It is UNOWNED and, after WI-3.6, read by no mdpro
//! code — the TOC addresses headings by document-order correspondence
//! (`src/utils/tocElementResolution.ts`, ADR-0014), pinned by the DOM-id-independence
//! case `E-L5` in `tests/toc-element-resolution.test.ts`. It is deliberately NOT
//! admitted to the parity corpus: mdpro neither produces nor consumes those ids, and
//! pinning a third party's output with no product contract behind it would break on
//! their patch releases for no behavioural reason. Full measurement lives in the
//! header of `tests/heading-identity-faces.test.ts`.
//!
//! ONE FURTHER SLUG GENERATOR EXISTS AND IS DELIBERATELY OUT OF SCOPE — it is
//! DEAD CODE, not a face of this parity claim (plan M `:413-420`):
//!   - `src-tauri/src/commands/toc.rs:36` `get_document_headings` — zero callers; it
//!     takes `content` while the TS wrapper passes `document_id`, so it could not be
//!     called successfully even if something tried. Retirement is stage 5.
//!
//! A second dead generator lived in `src/stores/` (zero references; it stripped CJK)
//! until WI-3.5.8 deleted it; `tests/dead-slug-removal.test.ts` fails if it returns.
//!
//! Nothing here asserts anything about the dead one that remains, or about the
//! Milkdown face. A reader must not conclude that "the slug generators agree" covers
//! all five.
//!
//! PLACEMENT — deviation from the test matrix, stated: the matrix asks for these in
//! `markdown.rs`'s own `#[cfg(test)]` module. That file is already 1534 lines against
//! rule 50's 300-line limit, and every case below takes `render_markdown` (public) as
//! its input, so an integration test reaches them with no loss of assertion strength
//! and without growing an already-oversized file. `cargo test` runs this file either
//! way; the `rust` guardian lane gates on commit only, so it must be invoked by hand.

use std::collections::HashSet;
use std::time::Instant;

use tauri_app_lib::services::markdown::render_markdown;

/// Extract the `id` of every `<h1>`–`<h6>` in document order.
///
/// Same shape as `heading_identity_parity.rs::heading_ids`, and deliberately not a
/// `contains("id=\"x-1-1\"")` substring check: `contains` cannot detect that `x-1`
/// appears *twice*, which is the entire defect WI-3.2 removes.
fn heading_ids(html: &str) -> Vec<String> {
    let bytes = html.as_bytes();
    let mut out = Vec::new();
    let mut cursor = 0usize;

    while let Some(rel) = html[cursor..].find("<h") {
        let level_idx = cursor + rel + 2;
        cursor = level_idx;
        match bytes.get(level_idx) {
            Some(b'1'..=b'6') => {}
            Some(_) => continue,
            None => break,
        }
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

fn ids_of(markdown: &str) -> Vec<String> {
    heading_ids(&render_markdown(markdown))
}

/// The closed output shape: non-empty, no leading or trailing `-`.
fn assert_shape(ids: &[String], where_: &str) {
    for id in ids {
        assert!(!id.is_empty(), "{where_}: empty id in {ids:?}");
        assert!(
            !id.starts_with('-'),
            "{where_}: id {id:?} has no base at all (bare suffix) in {ids:?}"
        );
        assert!(
            !id.ends_with('-'),
            "{where_}: id {id:?} ends with a separator in {ids:?}"
        );
    }
}

// ---------------------------------------------------------------------------
// F1 — suffix collision
// ---------------------------------------------------------------------------

#[test]
fn f1_suffix_collision_does_not_emit_a_duplicate_anchor() {
    // The third heading's LITERAL text already slugs to `x-1`, which a count-based
    // generator had just handed to the second heading.
    assert_eq!(ids_of("# x\n# x\n# x-1"), vec!["x", "x-1", "x-1-1"]);
}

// ---------------------------------------------------------------------------
// F2 — empty-base substitution happens BEFORE collision handling
// ---------------------------------------------------------------------------

#[test]
fn f2_empty_base_is_substituted_before_collision_handling() {
    // Rust was already correct on these two inputs before WI-3.2. This case is the
    // non-regression guard for the port: moving the `"heading"` substitution after
    // the occupancy check is the single way the TS bug could be copied into Rust.
    for md in ["# \u{1F389}\n# heading", "# \u{1F389}\n# \u{1F38A}"] {
        let ids = ids_of(md);
        assert_eq!(ids, vec!["heading", "heading-1"], "input {md:?}");
        assert_shape(&ids, md);
    }
}

#[test]
fn f2b_literal_first_then_emoji_is_symmetric() {
    // ADDENDUM A order asymmetry: an implementation could fix emoji-first and not
    // literal-first with nothing to catch it.
    let ids = ids_of("# heading\n# \u{1F389}");
    assert_eq!(ids, vec!["heading", "heading-1"]);
    assert_shape(&ids, "literal-then-emoji");
}

#[test]
fn f2c_substitution_search_skips_a_suffix_a_literal_already_took() {
    // ADDENDUM A defect-one x defect-two interaction, and the one input where the
    // pre-WI-3.2 Rust generator was itself DEFECTIVE: it produced
    // ["heading-1", "heading", "heading-1"] — a duplicate — because substituting
    // before *counting* is not the same as substituting before *collision handling*
    // against a taken set. Measured 2026-09-18.
    let ids = ids_of("# heading-1\n# \u{1F389}\n# \u{1F38A}");
    assert_eq!(ids, vec!["heading-1", "heading", "heading-2"]);
    assert_shape(&ids, "literal-suffix-then-two-emoji");
}

// ---------------------------------------------------------------------------
// F3 — the seed occupies the suffix but not the base
// ---------------------------------------------------------------------------

#[test]
fn f3_hint_is_rechecked_against_the_taken_set() {
    // A `lastTriedN` hint consulted WITHOUT re-checking set membership emits `x-1`
    // twice here. This is the one input where the hint and the taken set disagree.
    assert_eq!(ids_of("# x-1\n# x\n# x"), vec!["x-1", "x", "x-2"]);
}

// ---------------------------------------------------------------------------
// Corpus G — the identical LCG, seed and alphabet as tests/helpers/headingCorpus.ts
// ---------------------------------------------------------------------------

const DEFAULT_SEED: u32 = 0x5eed;

/// `s.wrapping_mul(1664525).wrapping_add(1013904223)` — Numerical Recipes constants,
/// deliberately the same recurrence the TS helper uses so both languages generate a
/// byte-identical corpus.
struct Lcg(u32);

impl Lcg {
    fn next(&mut self) -> u32 {
        self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
        self.0
    }
}

/// Must stay identical to `CORPUS_ALPHABET` in `tests/helpers/headingCorpus.ts`.
/// It deliberately excludes the known `\p{N}` / `is_alphanumeric()` divergence
/// characters (`Ⅷ`, `①`, `½`, combining marks) — that divergence is pre-existing,
/// recorded in the plan's Risks section, and is NOT closed by WI-3.2.
const CORPUS_ALPHABET: &[&str] = &[
    "x",
    "x-1",
    "x-1-1",
    "heading",
    "heading-1",
    "\u{1F389}",
    "\u{1F38A}",
    "架构",
    "第1章: 架构",
    "---",
    "Title",
    "INTRO",
    // "架构".repeat(50)
    "",
];

fn alphabet_token(i: usize) -> String {
    if i == CORPUS_ALPHABET.len() - 1 {
        "架构".repeat(50)
    } else {
        CORPUS_ALPHABET[i].to_string()
    }
}

fn generate_corpus(seed: u32, document_count: usize, max_headings: u32) -> Vec<Vec<String>> {
    let mut lcg = Lcg(seed);
    let mut documents = Vec::with_capacity(document_count);
    for _ in 0..document_count {
        let count = 1 + (lcg.next() % max_headings);
        let mut headings = Vec::with_capacity(count as usize);
        for _ in 0..count {
            headings.push(alphabet_token(lcg.next() as usize % CORPUS_ALPHABET.len()));
        }
        documents.push(headings);
    }
    documents
}

fn corpus_markdown(headings: &[String]) -> String {
    let mut md = String::new();
    for h in headings {
        md.push_str("# ");
        md.push_str(h);
        md.push('\n');
    }
    md
}

// ---------------------------------------------------------------------------
// F4 — document uniqueness over the generated corpus
// ---------------------------------------------------------------------------

#[test]
fn f4_document_uniqueness_over_generated_corpus() {
    let documents = generate_corpus(DEFAULT_SEED, 200, 50);

    for (d, headings) in documents.iter().enumerate() {
        let ids = ids_of(&corpus_markdown(headings));
        let where_ = format!("seed=0x{DEFAULT_SEED:x} document={d}");

        assert_eq!(
            ids.len(),
            headings.len(),
            "{where_}: every heading must produce an id"
        );
        let distinct: HashSet<&String> = ids.iter().collect();
        assert_eq!(
            distinct.len(),
            ids.len(),
            "{where_}: duplicate id in {ids:?}"
        );
        assert_shape(&ids, &where_);
    }
}

// ---------------------------------------------------------------------------
// F6 — scale
// ---------------------------------------------------------------------------

#[test]
fn f6_two_thousand_identical_headings_number_linearly() {
    // Correctness only. Stated plainly: at n=2000 an O(n²) rescan is ~2M `format!`
    // calls and finishes well under a second even in a debug build, so this case
    // CANNOT detect the regression the plan named it for. f6b is what separates them.
    let md = "# Base\n".repeat(2_000);
    let ids = ids_of(&md);

    assert_eq!(ids.len(), 2_000);
    assert_eq!(ids[0], "base");
    assert_eq!(ids[1_999], "base-1999");
    let distinct: HashSet<&String> = ids.iter().collect();
    assert_eq!(distinct.len(), 2_000, "duplicate id at scale");
}

#[test]
fn f6b_fifty_thousand_identical_headings_stay_linear() {
    // ~1.25G iterations naive versus ~50k linear. This is a guard against a
    // reintroduced O(n²) rescan, NOT a benchmark — decision E39 declined a
    // benchmarking harness, so the budget is deliberately generous.
    let md = "# Base\n".repeat(50_000);
    let started = Instant::now();
    let ids = ids_of(&md);
    let elapsed = started.elapsed();

    assert_eq!(ids.len(), 50_000);
    assert_eq!(ids[49_999], "base-49999");
    assert!(
        elapsed.as_secs() < 10,
        "50000 identical headings took {elapsed:?}; the monotone `last_tried_n` hint \
         was probably dropped and the suffix search restarts from 1 every time"
    );
}

// ---------------------------------------------------------------------------
// F7 — cross-language digest (the TS half asserts the same literal)
// ---------------------------------------------------------------------------

/// FNV-1a 32-bit over the UTF-8 bytes of every slug of every Corpus G document, each
/// slug followed by a single `0x0A` byte.
fn fnv1a32(bytes: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in bytes {
        h ^= u32::from(*b);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// Measured once on 2026-09-18. The identical literal is asserted on the TS side by
/// `tests/heading-identity-faces.test.ts` — grep for `CORPUS_G_SLUG_DIGEST`.
///
/// Cost, stated: this is a second synchronization surface. If the two corpus
/// GENERATORS drift, the digest fails without saying which half moved — hence the
/// failure message below.
const CORPUS_G_SLUG_DIGEST: u32 = 0x290f_15a3;

#[test]
fn f7_cross_language_corpus_digest() {
    let documents = generate_corpus(DEFAULT_SEED, 200, 50);
    let mut stream: Vec<u8> = Vec::new();

    for headings in &documents {
        for id in ids_of(&corpus_markdown(headings)) {
            stream.extend_from_slice(id.as_bytes());
            stream.push(b'\n');
        }
    }

    assert_eq!(
        fnv1a32(&stream),
        CORPUS_G_SLUG_DIGEST,
        "the TS and Rust allocators have diverged outside the fixed fixture cases, \
         or Corpus G's generator changed on one side only. Regenerate both and diff \
         the first mismatching document — the digest cannot tell you which half moved."
    );
}

// ---------------------------------------------------------------------------
// F8 — no panic path on pathological heading text
// ---------------------------------------------------------------------------

#[test]
fn f8_pathological_heading_text_yields_well_shaped_ids() {
    // `generate_heading_id` is reachable from `#[tauri::command]` input, so a panic
    // here takes down the command instead of surfacing an error. "Does not panic"
    // alone would be a Level 7 claim; the shape predicates are what make this a
    // real assertion.
    let cases: Vec<(&str, String)> = vec![
        ("10k combining marks", "\u{0301}".repeat(10_000)),
        ("C0 controls incl. NUL", "\u{0}\u{1}\u{2}\u{1f}".to_string()),
        ("1 MB single heading", "a".repeat(1_000_000)),
        ("dotted capital I", "İ".to_string()),
        (
            "ZWJ family sequence",
            "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}".to_string(),
        ),
        ("three hyphens", "---".to_string()),
        ("zero width space only", "\u{200B}".to_string()),
    ];

    for (label, text) in cases {
        // Two identical headings per document, so the collision path is exercised
        // on every pathological input as well.
        let md = format!("# {text}\n# {text}\n");
        let ids = ids_of(&md);

        assert_eq!(
            ids.len(),
            2,
            "{label}: expected two heading ids, got {ids:?}"
        );
        assert_shape(&ids, label);
        assert_ne!(ids[0], ids[1], "{label}: duplicate id {ids:?}");
    }
}
