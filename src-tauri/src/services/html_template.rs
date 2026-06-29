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

pub fn build_html(content: &str, title: &str, theme: &str) -> String {
    let safe_title = html_escape(title);
    let safe_theme = if theme == "dark" { "dark" } else { "light" };
    let (bg, text, code_bg, border) = if safe_theme == "dark" {
        ("#0f1115", "#e5e7eb", "#1b2230", "#242a36")
    } else {
        ("#ffffff", "#1a1a1a", "#f4f4f4", "#e5e7eb")
    };

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
        img {{ max-width: 100%; border-radius: 6px; }}",
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

    format!(
        "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n  <title>{}</title>\n  <style>{}</style>{}\n</head>\n<body class=\"{}\">\n  <article class=\"markdown-body\">{}\n  </article>\n</body>\n</html>",
        safe_title, styles, katex_block, safe_theme, content
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_math_omits_katex_css() {
        let html = build_html("<p>plain</p>", "doc", "light");
        assert!(!html.contains("KaTeX"), "no KaTeX CSS when no math present");
    }

    #[test]
    fn pre_rendered_math_inlines_katex_css() {
        let html = build_html(
            "<span class=\"katex\"><span class=\"katex-html\">x</span></span>",
            "doc",
            "light",
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
        let html = build_html("<div class=\"math-display\">x</div>", "doc", "dark");
        assert!(
            html.contains(".katex"),
            "placeholder must still pull in KaTeX CSS"
        );
    }

    #[test]
    fn title_is_html_escaped() {
        let html = build_html("<p>x</p>", "<script>", "light");
        assert!(!html.contains("<title><script>"), "title must be escaped");
        assert!(html.contains("&lt;script&gt;"), "escaped title expected");
    }
}
