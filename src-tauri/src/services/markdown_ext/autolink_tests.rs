//! Tests for the autolink/emoji preprocessor (split out so autolink.rs
//! stays under the ~300-line file limit; audit B-M1).

use super::*;

#[test]
fn bare_url_is_wrapped_for_autolink() {
    let out = preprocess_autolink_and_emoji("See https://example.com today");
    assert!(
        out.contains("<https://example.com>"),
        "bare URL must be wrapped in autolink brackets, got: {out}"
    );
}

#[test]
fn bare_url_inside_code_fence_is_not_linked() {
    let md = "```\nhttps://example.com\n```";
    let out = preprocess_autolink_and_emoji(md);
    assert!(
        !out.contains("<https://example.com>"),
        "URL inside a code fence must NOT be autolinked, got: {out}"
    );
    assert!(
        out.contains("https://example.com"),
        "literal URL preserved, got: {out}"
    );
}

#[test]
fn bare_url_inside_inline_code_is_not_linked() {
    let out = preprocess_autolink_and_emoji("Run `curl https://example.com` now");
    assert!(
        !out.contains("<https://example.com>"),
        "URL in inline code must NOT be autolinked, got: {out}"
    );
}

#[test]
fn existing_markdown_link_url_is_not_double_wrapped() {
    let out = preprocess_autolink_and_emoji("[site](https://example.com)");
    assert!(
        !out.contains("<https://example.com>"),
        "URL already in a link target must not be wrapped, got: {out}"
    );
    assert!(
        out.contains("[site](https://example.com)"),
        "link preserved, got: {out}"
    );
}

#[test]
fn existing_autolink_is_not_re_wrapped() {
    let out = preprocess_autolink_and_emoji("<https://example.com>");
    assert!(
        !out.contains("<<https"),
        "existing autolink must not be re-wrapped, got: {out}"
    );
}

#[test]
fn url_trailing_sentence_punctuation_is_excluded() {
    let out = preprocess_autolink_and_emoji("Visit https://example.com.");
    assert!(
        out.contains("<https://example.com>."),
        "trailing period must stay outside the link, got: {out}"
    );
}

#[test]
fn known_emoji_shortcode_becomes_glyph() {
    let out = preprocess_autolink_and_emoji("Nice work :tada:");
    assert!(
        out.contains("🎉"),
        "known shortcode must render glyph, got: {out}"
    );
    assert!(
        !out.contains(":tada:"),
        "shortcode literal must be replaced, got: {out}"
    );
}

#[test]
fn unknown_emoji_shortcode_stays_literal() {
    let out = preprocess_autolink_and_emoji("Token :notarealemoji: here");
    assert!(
        out.contains(":notarealemoji:"),
        "unknown shortcode must stay literal, got: {out}"
    );
}

#[test]
fn emoji_inside_code_is_not_replaced() {
    let out = preprocess_autolink_and_emoji("`:tada:`");
    assert!(
        out.contains(":tada:"),
        "emoji in inline code stays literal, got: {out}"
    );
    assert!(
        !out.contains("🎉"),
        "emoji in code must not render, got: {out}"
    );
}

#[test]
fn bare_url_scheme_check_is_case_insensitive() {
    // The fixed-head check must still match mixed-case schemes (regression
    // guard for the A2 rewrite that dropped the whole-slice lowercase).
    let out = preprocess_autolink_and_emoji("See HTTPS://Example.com/Path now");
    assert!(
        out.contains("<HTTPS://Example.com/Path>"),
        "mixed-case scheme must still autolink, got: {out}"
    );
}

#[test]
fn long_non_url_line_processes_without_quadratic_blowup() {
    // A2: try_bare_url is called per byte position. Before the fix it
    // allocated `s.to_ascii_lowercase()` of the whole remaining slice on
    // EVERY call → O(N²) per line (a degenerate 800K line froze ~9.75s).
    // A 200K-char non-URL line must process quickly AND a real bare URL in
    // ordinary text must still autolink — proving the allocation is gone and
    // behavior is preserved.
    let degenerate = "x".repeat(200_000);
    let input = format!("{degenerate} see https://example.com end");
    let out = preprocess_autolink_and_emoji(&input);
    assert!(
        out.contains("<https://example.com>"),
        "bare URL after a long non-URL run must still autolink"
    );
    // The long non-URL prefix is untouched (no spurious wrapping).
    assert!(out.starts_with(&degenerate), "non-URL text preserved");
    assert_eq!(
        out.matches("<https://").count(),
        1,
        "exactly one URL wrapped, no spurious autolinks"
    );
}
