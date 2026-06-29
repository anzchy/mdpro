//! WI-1.1 — math wrappers for the canonical (Rust) render surface.
//!
//! pulldown-cmark's default writer emits `<span class="math math-inline">` for
//! both inline and display math. mdpro's KaTeX/MathML pass keys off a distinct
//! `.math-inline` / `.math-display` split, so we render those wrappers here,
//! carrying the *raw, HTML-escaped* TeX.

use super::html_escape;

/// Render an inline-math event to mdpro's wrapper. The raw TeX is HTML-escaped
/// and carried verbatim so the KaTeX pass can read it from `textContent`.
pub fn render_inline_math(tex: &str) -> String {
    format!("<span class=\"math-inline\">{}</span>", html_escape(tex))
}

/// Render a display-math event to mdpro's block wrapper.
pub fn render_display_math(tex: &str) -> String {
    format!("<div class=\"math-display\">{}</div>", html_escape(tex))
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
