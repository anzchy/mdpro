//! Purpose: math + footnote post-processing for the canonical (Rust)
//! markdown render surface (WI-1.1, WI-1.3 of the Typora-parity plan).
//!
//! pulldown-cmark 0.11 exposes `Options::ENABLE_MATH` and
//! `Options::ENABLE_FOOTNOTES`, but its default HTML writer:
//!   - emits `<span class="math math-inline">` for BOTH inline and display
//!     math (not the `<span class="math-inline">` / `<div class="math-display">`
//!     split mdpro's KaTeX pass keys off), and
//!   - does NOT emit a return ("back-link") anchor from a footnote definition
//!     back to its reference.
//!
//! This module supplies:
//!   - [`render_inline_math`] / [`render_display_math`] — emit mdpro's wrapper
//!     classes carrying the *raw, HTML-escaped* TeX so the KaTeX pass (preview)
//!     or KaTeX-in-export can typeset it. Math inside a code fence never reaches
//!     here because pulldown-cmark does not emit math events inside code.
//!   - [`add_footnote_back_links`] — a post-render rewrite that gives every
//!     footnote reference a stable `id` and appends a `↩` back-link to each
//!     definition pointing at its (first) reference. In-doc anchors only — the
//!     sanitizer (`sanitize_html`) drops any non-`#` href regardless.
//!
//! @coordinates-with src-tauri/src/services/markdown.rs (render loop calls the
//!   math helpers; `render_markdown` calls `add_footnote_back_links`)
//! @coordinates-with src/components/Preview/mathRender.ts (KaTeX pass keys off
//!   `.math-inline` / `.math-display`)

/// Escape the five HTML-significant characters. Mirrors `markdown::html_escape`
/// (kept local so this module has no cross-call dependency on the parent).
fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

/// Render an inline-math event to mdpro's wrapper. The raw TeX is HTML-escaped
/// and carried verbatim so the KaTeX pass can read it from `textContent`.
pub fn render_inline_math(tex: &str) -> String {
    format!("<span class=\"math-inline\">{}</span>", html_escape(tex))
}

/// Render a display-math event to mdpro's block wrapper.
pub fn render_display_math(tex: &str) -> String {
    format!("<div class=\"math-display\">{}</div>", html_escape(tex))
}

/// Append return ("back-link") anchors to footnote definitions and stamp a
/// stable `id` on each reference so the back-link resolves.
///
/// pulldown-cmark emits:
///   ref → `<sup class="footnote-reference"><a href="#NAME">N</a></sup>`
///   def → `<div class="footnote-definition" id="NAME">…<p>text</p></div>`
///
/// We rewrite to:
///   ref → `<sup class="footnote-reference" id="fnref-NAME"><a href="#NAME">N</a></sup>`
///   def → the same div, with `<a href="#fnref-NAME" class="footnote-backref" aria-label="Back to reference">↩</a>`
///         inserted just before the definition's closing `</div>`.
///
/// Only the FIRST reference of each footnote gets the `id` (HTML ids must be
/// unique); the back-link therefore returns to the first citation, matching
/// GitHub/Typora behavior for the common single-reference case.
pub fn add_footnote_back_links(html: &str) -> String {
    if !html.contains("footnote-reference") && !html.contains("footnote-definition") {
        return html.to_string();
    }

    // Pass 1: stamp `id="fnref-NAME"` on the first reference of each name.
    let mut seen_refs: std::collections::HashSet<String> = std::collections::HashSet::new();
    let stamped = rewrite_references(html, &mut seen_refs);

    // Pass 2: append a back-link to each definition whose name was referenced.
    rewrite_definitions(&stamped, &seen_refs)
}

const REF_OPEN: &str = "<sup class=\"footnote-reference\"><a href=\"#";

fn rewrite_references(html: &str, seen: &mut std::collections::HashSet<String>) -> String {
    let mut out = String::with_capacity(html.len() + 64);
    let mut rest = html;
    while let Some(idx) = rest.find(REF_OPEN) {
        out.push_str(&rest[..idx]);
        let after_open = &rest[idx + REF_OPEN.len()..];
        // The name runs up to the closing `"` of the href.
        let Some(quote) = after_open.find('"') else {
            // Malformed — emit the matched prefix verbatim and stop scanning.
            out.push_str(&rest[idx..]);
            return out;
        };
        let name = &after_open[..quote];
        if seen.insert(name.to_string()) {
            // First occurrence: inject the id on the <sup>.
            out.push_str(&format!(
                "<sup class=\"footnote-reference\" id=\"fnref-{}\"><a href=\"#",
                name
            ));
        } else {
            // Subsequent occurrence: leave as-is (an HTML id must stay unique).
            out.push_str(REF_OPEN);
        }
        // Advance past the open marker; continue scanning the remainder so
        // multiple references are all handled.
        rest = after_open;
    }
    out.push_str(rest);
    out
}

fn rewrite_definitions(html: &str, referenced: &std::collections::HashSet<String>) -> String {
    const DEF_OPEN: &str = "<div class=\"footnote-definition\" id=\"";
    if !html.contains(DEF_OPEN) {
        return html.to_string();
    }
    let mut out = String::with_capacity(html.len() + 128);
    let mut rest = html;
    while let Some(idx) = rest.find(DEF_OPEN) {
        // Find the definition's name.
        let name_start = idx + DEF_OPEN.len();
        let Some(quote_rel) = rest[name_start..].find('"') else {
            out.push_str(rest);
            return out;
        };
        let name = rest[name_start..name_start + quote_rel].to_string();
        // Find the matching closing </div> for this definition. Definitions are
        // not nested in pulldown-cmark's output, so the next </div> after the
        // open tag closes it.
        let Some(close_rel) = rest[name_start..].find("</div>") else {
            out.push_str(rest);
            return out;
        };
        let close_abs = name_start + close_rel;
        // Emit everything up to (not including) the closing </div>.
        out.push_str(&rest[..close_abs]);
        if referenced.contains(&name) {
            out.push_str(&format!(
                "<a href=\"#fnref-{}\" class=\"footnote-backref\" aria-label=\"Back to reference\">↩</a>",
                name
            ));
        }
        out.push_str("</div>");
        rest = &rest[close_abs + "</div>".len()..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Math wrappers (WI-1.1) ---

    #[test]
    fn inline_math_emits_mdpro_wrapper_with_raw_tex() {
        let out = render_inline_math("x^2 + 1");
        assert_eq!(out, "<span class=\"math-inline\">x^2 + 1</span>");
    }

    #[test]
    fn display_math_emits_block_wrapper_with_raw_tex() {
        let out = render_display_math("\\int_0^1 x\\,dx");
        assert!(
            out.starts_with("<div class=\"math-display\">"),
            "got: {out}"
        );
        assert!(out.ends_with("</div>"), "got: {out}");
        assert!(out.contains("\\int_0^1"), "raw tex preserved, got: {out}");
    }

    #[test]
    fn math_tex_is_html_escaped() {
        // TeX carrying HTML-significant chars must be escaped so it can't inject.
        let out = render_inline_math("a < b && c > d");
        assert!(!out.contains("<b"), "got: {out}");
        assert!(out.contains("a &lt; b &amp;&amp; c &gt; d"), "got: {out}");
    }

    #[test]
    fn math_script_payload_is_escaped() {
        let out = render_inline_math("</span><script>alert(1)</script>");
        assert!(
            !out.contains("<script>"),
            "script must be escaped, got: {out}"
        );
        assert!(out.contains("&lt;script&gt;"), "got: {out}");
    }

    // --- Footnote back-links (WI-1.3) ---

    #[test]
    fn single_footnote_gets_id_and_backlink() {
        let html = concat!(
            "<p>Text<sup class=\"footnote-reference\"><a href=\"#1\">1</a></sup></p>\n",
            "<div class=\"footnote-definition\" id=\"1\">",
            "<sup class=\"footnote-definition-label\">1</sup><p>The note.</p></div>",
        );
        let out = add_footnote_back_links(html);
        // Reference gets a stable id.
        assert!(
            out.contains("<sup class=\"footnote-reference\" id=\"fnref-1\">"),
            "reference id missing, got: {out}"
        );
        // Definition gets a back-link to that id, before its closing </div>.
        assert!(
            out.contains("href=\"#fnref-1\""),
            "back-link href missing, got: {out}"
        );
        assert!(
            out.contains("class=\"footnote-backref\""),
            "back-link class missing, got: {out}"
        );
        // The back-link sits inside the definition div (before </div>).
        let backref_pos = out.find("footnote-backref").unwrap();
        let close_pos = out.rfind("</div>").unwrap();
        assert!(
            backref_pos < close_pos,
            "back-link must precede </div>, got: {out}"
        );
    }

    #[test]
    fn multiple_footnotes_each_resolve() {
        let html = concat!(
            "<p>A<sup class=\"footnote-reference\"><a href=\"#a\">1</a></sup> ",
            "B<sup class=\"footnote-reference\"><a href=\"#b\">2</a></sup></p>\n",
            "<div class=\"footnote-definition\" id=\"a\"><p>note a</p></div>\n",
            "<div class=\"footnote-definition\" id=\"b\"><p>note b</p></div>",
        );
        let out = add_footnote_back_links(html);
        assert!(out.contains("id=\"fnref-a\""), "got: {out}");
        assert!(out.contains("id=\"fnref-b\""), "got: {out}");
        assert!(out.contains("href=\"#fnref-a\""), "got: {out}");
        assert!(out.contains("href=\"#fnref-b\""), "got: {out}");
    }

    #[test]
    fn definition_without_reference_gets_no_backlink() {
        // A definition whose name was never referenced should not get a dangling
        // back-link to a non-existent fnref id.
        let html = "<div class=\"footnote-definition\" id=\"orphan\"><p>unused</p></div>";
        let out = add_footnote_back_links(html);
        assert!(
            !out.contains("footnote-backref"),
            "no back-link expected, got: {out}"
        );
    }

    #[test]
    fn repeated_reference_keeps_id_unique() {
        // Two references to the same footnote: only the first carries the id.
        let html = concat!(
            "<sup class=\"footnote-reference\"><a href=\"#x\">1</a></sup>",
            "<sup class=\"footnote-reference\"><a href=\"#x\">1</a></sup>",
            "<div class=\"footnote-definition\" id=\"x\"><p>n</p></div>",
        );
        let out = add_footnote_back_links(html);
        let id_count = out.matches("id=\"fnref-x\"").count();
        assert_eq!(id_count, 1, "id must appear exactly once, got: {out}");
    }

    #[test]
    fn no_footnotes_is_passthrough() {
        let html = "<p>Just text, no footnotes.</p>";
        assert_eq!(add_footnote_back_links(html), html);
    }

    #[test]
    fn ordering_preserved() {
        // Definitions emitted in document order stay in order after rewrite.
        let html = concat!(
            "<sup class=\"footnote-reference\"><a href=\"#1\">1</a></sup>",
            "<sup class=\"footnote-reference\"><a href=\"#2\">2</a></sup>",
            "<div class=\"footnote-definition\" id=\"1\"><p>first</p></div>",
            "<div class=\"footnote-definition\" id=\"2\"><p>second</p></div>",
        );
        let out = add_footnote_back_links(html);
        let first = out.find("first").unwrap();
        let second = out.find("second").unwrap();
        assert!(
            first < second,
            "definition order must be preserved, got: {out}"
        );
    }
}
