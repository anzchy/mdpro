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

// ---------------------------------------------------------------------------
// WI-1.4 — Auto-link bare URLs + emoji shortcodes
//
// pulldown-cmark 0.11 has no bare-URL autolink option (ENABLE_GFM only covers
// blockquote alert tags). We preprocess the markdown source: a bare
// `http(s)://…` URL is wrapped in CommonMark autolink angle brackets so the
// parser linkifies it, and known `:shortcode:` emoji are replaced with their
// glyph. Both transforms skip fenced/indented code blocks and inline code
// spans (a URL or `:smile:` inside code stays literal), and the URL pass also
// skips URLs already inside a markdown link target `](…)` or already wrapped
// in `<…>`.
// ---------------------------------------------------------------------------

/// Curated emoji shortcode → glyph map. Conservative on purpose: an unknown
/// `:shortcode:` is left literal (never destructive). Covers the common set a
/// technical writer reaches for; extend as needed.
fn emoji_glyph(name: &str) -> Option<&'static str> {
    Some(match name {
        "smile" => "😄",
        "grin" => "😁",
        "joy" => "😂",
        "wink" => "😉",
        "heart" => "❤️",
        "thumbsup" | "+1" => "👍",
        "thumbsdown" | "-1" => "👎",
        "tada" => "🎉",
        "rocket" => "🚀",
        "fire" => "🔥",
        "star" => "⭐",
        "warning" => "⚠️",
        "check" | "white_check_mark" => "✅",
        "x" => "❌",
        "bulb" => "💡",
        "eyes" => "👀",
        "sparkles" => "✨",
        "100" => "💯",
        "pray" => "🙏",
        "ok_hand" => "👌",
        _ => return None,
    })
}

/// Apply the WI-1.4 source transforms (emoji + bare-URL autolink) to a markdown
/// document, skipping code fences/indented-code and inline code spans.
pub fn preprocess_autolink_and_emoji(markdown: &str) -> String {
    let normalized = markdown.replace("\r\n", "\n");
    let mut out = String::with_capacity(normalized.len() + 32);
    let mut in_fence = false;
    let mut fence_char = ' ';
    let mut fence_len = 0usize;
    let lines: Vec<&str> = normalized.split('\n').collect();
    let line_count = lines.len();

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if in_fence {
            let close_len = trimmed.chars().take_while(|&c| c == fence_char).count();
            if close_len >= fence_len && trimmed[close_len..].trim().is_empty() {
                in_fence = false;
            }
            out.push_str(line);
        } else if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let fc = trimmed.chars().next().unwrap_or('`');
            let fl = trimmed.chars().take_while(|&c| c == fc).count();
            if trimmed[fl..].trim().find(fc).is_none() {
                in_fence = true;
                fence_char = fc;
                fence_len = fl;
            }
            out.push_str(line);
        } else {
            let indent_len = line.len() - trimmed.len();
            if line.starts_with('\t') || indent_len >= 4 {
                // Indented code block: leave untouched.
                out.push_str(line);
            } else {
                out.push_str(&transform_line(line));
            }
        }
        if idx + 1 < line_count {
            out.push('\n');
        }
    }
    if normalized.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// Transform a single non-code line: emoji then bare-URL autolink, skipping
/// inline code spans.
fn transform_line(line: &str) -> String {
    let bytes = line.as_bytes();
    let n = bytes.len();
    let mut out = String::with_capacity(n);
    let mut i = 0;
    while i < n {
        // Copy inline code spans verbatim.
        if bytes[i] == b'`' {
            let start = i;
            while i < n && bytes[i] == b'`' {
                i += 1;
            }
            let tick_len = i - start;
            let close: Vec<u8> = vec![b'`'; tick_len];
            if let Some(rel) = line[i..]
                .as_bytes()
                .windows(tick_len)
                .position(|w| w == close)
            {
                let end = i + rel + tick_len;
                out.push_str(&line[start..end]);
                i = end;
            } else {
                out.push_str(&line[start..i]);
            }
            continue;
        }
        // Copy an existing markdown link target `](…)` verbatim so a URL inside
        // it is not double-wrapped.
        if bytes[i] == b']' && i + 1 < n && bytes[i + 1] == b'(' {
            let start = i;
            i += 2;
            let mut depth = 1i32;
            while i < n {
                match bytes[i] {
                    b'(' => {
                        depth += 1;
                        i += 1;
                    }
                    b')' => {
                        depth -= 1;
                        i += 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => i += 1,
                }
            }
            out.push_str(&line[start..i]);
            continue;
        }
        // Copy an existing `<…>` autolink verbatim.
        if bytes[i] == b'<' {
            if let Some(rel) = line[i..].find('>') {
                let end = i + rel + 1;
                out.push_str(&line[i..end]);
                i = end;
                continue;
            }
        }
        // Emoji shortcode `:name:`.
        if bytes[i] == b':' {
            if let Some((glyph, consumed)) = try_emoji(&line[i..]) {
                out.push_str(glyph);
                i += consumed;
                continue;
            }
        }
        // Bare URL `http://` / `https://`.
        if let Some(url_len) = try_bare_url(&line[i..]) {
            // Don't autolink a URL immediately preceded by `(` (likely a link
            // target the `](` guard missed) or by `@`/`/` (already in a path).
            let prev = if i == 0 { b' ' } else { bytes[i - 1] };
            if prev == b'(' || prev == b'<' {
                out.push_str(&line[i..i + url_len]);
            } else {
                out.push('<');
                out.push_str(&line[i..i + url_len]);
                out.push('>');
            }
            i += url_len;
            continue;
        }
        // UTF-8-safe advance.
        let ch = line[i..].chars().next().unwrap_or('\0');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// If `s` starts with `:name:` whose name is a known emoji, return the glyph
/// and the byte length consumed (including both colons).
fn try_emoji(s: &str) -> Option<(&'static str, usize)> {
    debug_assert!(s.starts_with(':'));
    let rest = &s[1..];
    let close = rest.find(':')?;
    let name = &rest[..close];
    // Shortcodes are short, alphanumeric + `_`/`+`/`-`. Reject empty / spaced.
    if name.is_empty()
        || name.len() > 32
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'+' || b == b'-')
    {
        return None;
    }
    let glyph = emoji_glyph(name)?;
    Some((glyph, 1 + close + 1))
}

/// If `s` starts with a bare `http://`/`https://` URL, return its byte length.
/// The URL ends at the first whitespace or a trailing-punctuation char that is
/// unlikely to belong to the URL (`)`, `]`, `<`, `>`, `"`, `'`, and a sentence
/// `.`/`,`/`!`/`?` immediately followed by end-of-string or whitespace).
fn try_bare_url(s: &str) -> Option<usize> {
    let lower = s.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return None;
    }
    let bytes = s.as_bytes();
    let mut end = 0;
    while end < bytes.len() {
        let c = bytes[end];
        if c.is_ascii_whitespace() || matches!(c, b'<' | b'>' | b'"' | b'\'' | b'`' | b'|') {
            break;
        }
        end += 1;
    }
    // Trim trailing sentence punctuation and an unbalanced closing paren/bracket.
    while end > 0 {
        let last = bytes[end - 1];
        if matches!(last, b'.' | b',' | b'!' | b'?' | b';' | b':') {
            end -= 1;
        } else if last == b')' {
            // Keep a `)` only if there's a matching `(` inside the URL.
            let opens = s[..end].matches('(').count();
            let closes = s[..end].matches(')').count();
            if closes > opens {
                end -= 1;
            } else {
                break;
            }
        } else {
            break;
        }
    }
    // Must have more than just the scheme.
    let scheme_len = if lower.starts_with("https://") { 8 } else { 7 };
    if end <= scheme_len {
        return None;
    }
    Some(end)
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

    // --- Auto-link + emoji (WI-1.4) ---

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
