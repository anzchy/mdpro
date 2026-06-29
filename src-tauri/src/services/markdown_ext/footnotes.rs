//! WI-1.3 — footnote back-links.
//!
//! pulldown-cmark emits footnote references and definitions but no return
//! ("back-link") anchor from a definition to its reference. This module
//! post-processes the rendered HTML to add them.

use std::collections::HashSet;

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
    let mut seen_refs: HashSet<String> = HashSet::new();
    let stamped = rewrite_references(html, &mut seen_refs);

    // Pass 2: append a back-link to each definition whose name was referenced.
    rewrite_definitions(&stamped, &seen_refs)
}

const REF_OPEN: &str = "<sup class=\"footnote-reference\"><a href=\"#";

fn rewrite_references(html: &str, seen: &mut HashSet<String>) -> String {
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

fn rewrite_definitions(html: &str, referenced: &HashSet<String>) -> String {
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
