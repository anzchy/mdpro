fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

/// Vendored KaTeX stylesheet (WI-1.1). Inlined into exported HTML when the
/// document contains pre-rendered math so the export renders fully offline with
/// zero JS. Font glyphs reference relative `fonts/` URLs that won't resolve in a
/// standalone file — KaTeX degrades to the system math font; the layout/markup
/// is correct and readable. (Base64 font embedding is a documented follow-up.)
const KATEX_CSS: &str = include_str!("../../assets/katex.min.css");

/// True when the rendered body carries pre-rendered KaTeX output (a `katex`
/// wrapper) OR an un-rendered math placeholder. Either way the KaTeX CSS is
/// needed to lay the math out.
fn needs_katex_css(content: &str) -> bool {
    content.contains("class=\"katex")
        || content.contains("class=\"math-inline\"")
        || content.contains("class=\"math-display\"")
}

/// Build a standalone HTML document around a pre-rendered body fragment.
///
/// When `include_styles` is `true` (the historical behavior) the main themed
/// `<style>` block — now including an `@media print` rule so browser-print and
/// PDF export paginate cleanly — is emitted, and the vendored KaTeX stylesheet
/// is inlined when the body carries math. When `false`, BOTH style blocks are
/// omitted so callers can supply their own styling (or none); the body/article
/// markup is still produced unchanged.
pub fn build_html(content: &str, title: &str, theme: &str, include_styles: bool) -> String {
    let safe_title = html_escape(title);
    let safe_theme = if theme == "dark" { "dark" } else { "light" };
    let (bg, text, code_bg, border) = if safe_theme == "dark" {
        ("#0f1115", "#e5e7eb", "#1b2230", "#242a36")
    } else {
        ("#ffffff", "#1a1a1a", "#f4f4f4", "#e5e7eb")
    };

    let style_blocks = if include_styles {
        let styles = format!(
            "body {{ background: {bg}; color: {text}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }}\n\
            .markdown-body {{ max-width: 860px; margin: 40px auto; padding: 0 24px; line-height: 1.7; }}\n\
            h1, h2, h3, h4 {{ margin: 24px 0 12px; }}\n\
            pre {{ background: {code_bg}; padding: 16px; border-radius: 8px; overflow: auto; }}\n\
            code {{ background: {code_bg}; padding: 2px 4px; border-radius: 4px; }}\n\
            table {{ width: 100%; border-collapse: collapse; margin: 16px 0; }}\n\
            th, td {{ border: 1px solid {border}; padding: 8px 10px; text-align: left; }}\n\
            th[align=\"center\"], td[align=\"center\"] {{ text-align: center; }}\n\
            th[align=\"right\"], td[align=\"right\"] {{ text-align: right; }}\n\
            blockquote {{ border-left: 3px solid {border}; padding-left: 12px; color: #6b7280; }}\n\
            img {{ max-width: 100%; border-radius: 6px; }}\n\
            @media print {{ body {{ background: #fff; color: #000; }} pre, blockquote, table, img {{ page-break-inside: avoid; }} }}",
            bg = bg,
            text = text,
            code_bg = code_bg,
            border = border
        );

        // Inline KaTeX CSS only when the body actually contains math, so non-math
        // exports stay lean.
        let katex_block = if needs_katex_css(content) {
            format!("\n  <style>{}</style>", KATEX_CSS)
        } else {
            String::new()
        };

        format!("\n  <style>{}</style>{}", styles, katex_block)
    } else {
        String::new()
    };

    format!(
        "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n  <title>{}</title>{}\n</head>\n<body class=\"{}\">\n  <article class=\"markdown-body\">{}\n  </article>\n</body>\n</html>",
        safe_title, style_blocks, safe_theme, content
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::markdown;

    #[test]
    fn no_math_omits_katex_css() {
        let html = build_html("<p>plain</p>", "doc", "light", true);
        assert!(!html.contains("KaTeX"), "no KaTeX CSS when no math present");
    }

    #[test]
    fn pre_rendered_math_inlines_katex_css() {
        let html = build_html(
            "<span class=\"katex\"><span class=\"katex-html\">x</span></span>",
            "doc",
            "light",
            true,
        );
        // The vendored KaTeX stylesheet defines `.katex` — its presence proves
        // the CSS was inlined.
        assert!(
            html.contains(".katex"),
            "KaTeX CSS must be inlined for math export"
        );
    }

    #[test]
    fn math_placeholder_also_inlines_css() {
        let html = build_html("<div class=\"math-display\">x</div>", "doc", "dark", true);
        assert!(
            html.contains(".katex"),
            "placeholder must still pull in KaTeX CSS"
        );
    }

    #[test]
    fn title_is_html_escaped() {
        let html = build_html("<p>x</p>", "<script>", "light", true);
        assert!(!html.contains("<title><script>"), "title must be escaped");
        assert!(html.contains("&lt;script&gt;"), "escaped title expected");
    }

    // -----------------------------------------------------------------------
    // WI-1 — include_styles toggle + @media print
    // -----------------------------------------------------------------------

    // A1: include_styles=false omits the <style> block but keeps the body.
    #[test]
    fn include_styles_false_omits_style_block() {
        let html = build_html(
            "<p>visible body text</p>",
            "doc",
            "light",
            false,
        );
        assert!(
            !html.contains("<style"),
            "no <style> block when include_styles=false, got: {html}"
        );
        assert!(
            html.contains("visible body text"),
            "body text must still be emitted"
        );
        assert!(html.contains("<body"), "body element must still be emitted");
    }

    // A2: include_styles=true preserves the current main style block (regression pin).
    #[test]
    fn include_styles_true_keeps_main_style_block() {
        let html = build_html(
            "<p>regression body</p>",
            "doc",
            "light",
            true,
        );
        assert!(html.contains("<style"), "style block expected");
        assert!(
            html.contains(".markdown-body"),
            "existing CSS token .markdown-body must survive"
        );
        assert!(
            html.contains("blockquote"),
            "existing CSS token blockquote must survive"
        );
        assert!(html.contains("regression body"), "body text expected");
    }

    // A3: @media print is present only when styles are included.
    #[test]
    fn media_print_present_only_when_styles_included() {
        let with = build_html("<p>x</p>", "doc", "light", true);
        let without = build_html("<p>x</p>", "doc", "light", false);
        assert!(
            with.contains("@media print"),
            "print stylesheet must be present when styles included"
        );
        assert!(
            !without.contains("@media print"),
            "no print stylesheet when styles omitted"
        );
    }

    // A4: golden — real render_markdown fragment carries table/pre/img/math markers
    // through build_html. (math-inline is produced by render_markdown in this build.)
    #[test]
    fn golden_real_fragment_markers_survive() {
        let source = "$x$\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```rust\nlet y = 1;\n```\n\n![alt](img.png)\n";
        let frag = markdown::render_markdown(source);
        let html = build_html(&frag, "golden", "light", true);
        assert!(html.contains("math-inline"), "math marker expected: {html}");
        assert!(html.contains("<table"), "table marker expected: {html}");
        assert!(html.contains("<pre"), "pre marker expected: {html}");
        assert!(html.contains("<img"), "img marker expected: {html}");
    }
}
