fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
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
        blockquote {{ border-left: 3px solid {border}; padding-left: 12px; color: #6b7280; }}\n\
        img {{ max-width: 100%; border-radius: 6px; }}",
        bg = bg,
        text = text,
        code_bg = code_bg,
        border = border
    );

    format!(
        "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n  <title>{}</title>\n  <style>{}</style>\n</head>\n<body class=\"{}\">\n  <article class=\"markdown-body\">{}\n  </article>\n</body>\n</html>",
        safe_title, styles, safe_theme, content
    )
}
