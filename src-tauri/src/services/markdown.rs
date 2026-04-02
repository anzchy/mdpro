use pulldown_cmark::{html, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use std::collections::HashMap;

/// Escape HTML special characters to prevent XSS when injecting text into HTML attributes or content.
fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

/// Generate unique anchor ID from heading text (must match tocService.ts).
///
/// Algorithm mirrors the JS `generateUniqueId` in tocService.ts:
/// - Lowercase the text
/// - Replace each run of non-alphanumeric characters with a single `-`
/// - Strip leading/trailing hyphens
fn generate_heading_id(text: &str, counts: &mut HashMap<String, usize>) -> String {
    // Replace runs of non-alphanumeric chars with a single hyphen (matches JS /[^\p{L}\p{N}]+/gu → "-")
    let mut base_id = String::new();
    let mut in_sep = false;
    for c in text.to_lowercase().chars() {
        if c.is_alphanumeric() {
            base_id.push(c);
            in_sep = false;
        } else if !in_sep {
            base_id.push('-');
            in_sep = true;
        }
    }
    let base_id = base_id.trim_matches('-').to_string();
    let base_id = if base_id.is_empty() {
        "heading".to_string()
    } else {
        base_id
    };

    let count = *counts.get(&base_id).unwrap_or(&0);
    let id = if count == 0 {
        base_id.clone()
    } else {
        format!("{}-{}", base_id, count)
    };
    counts.insert(base_id, count + 1);

    id
}

/// Replace `==text==` highlight syntax with `<mark>text</mark>` HTML.
///
/// Skips content inside fenced code blocks (``` / ~~~) and inline backtick
/// code spans so that literal `==` characters in code are never converted.
/// pulldown-cmark 0.11 has no `ENABLE_HIGHLIGHT` flag, so we preprocess
/// before parsing. Inline HTML is already allowed by the parser.
fn preprocess_highlight(markdown: &str) -> String {
    // Normalise CRLF → LF so that `==highlight==\r` at end-of-line doesn't
    // break closing-marker detection (see #182).
    let markdown = markdown.replace("\r\n", "\n");
    let markdown = markdown.as_str();
    let mut out = String::with_capacity(markdown.len() + 64);
    let mut in_fence = false;
    let mut fence_char = ' ';
    let mut fence_len = 0usize;
    let lines: Vec<&str> = markdown.split('\n').collect();
    let line_count = lines.len();

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if in_fence {
            // Detect closing fence: same char, same or greater length, rest is whitespace
            let close_len = trimmed
                .chars()
                .take_while(|&c| c == fence_char)
                .count();
            if close_len >= fence_len && trimmed[close_len..].trim().is_empty() {
                in_fence = false;
            }
            out.push_str(line);
        } else if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let fc = trimmed.chars().next().unwrap_or('`');
            let fl = trimmed.chars().take_while(|&c| c == fc).count();
            // Only open fence if the fence char doesn't appear again on the same line.
            // (CommonMark: backtick fences can't have backtick in their info string.)
            if trimmed[fl..].trim().find(fc).is_none() {
                in_fence = true;
                fence_char = fc;
                fence_len = fl;
            }
            out.push_str(line);
        } else {
            // Skip indented code blocks (4 spaces or 1 tab = CommonMark indented code)
            let indent_len = line.len() - trimmed.len();
            if line.starts_with('\t') || indent_len >= 4 {
                out.push_str(line);
            } else {
                out.push_str(&replace_highlight_inline(line));
            }
        }
        if idx + 1 < line_count {
            out.push('\n');
        }
    }

    // Preserve trailing newline from original
    if markdown.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }

    out
}

/// Replace `==text==` patterns in a single line, respecting inline code spans.
fn replace_highlight_inline(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let bytes = line.as_bytes();
    let n = bytes.len();
    let mut i = 0;

    while i < n {
        // Skip inline code spans (single or multi-backtick)
        if bytes[i] == b'`' {
            let tick_start = i;
            while i < n && bytes[i] == b'`' {
                i += 1;
            }
            let tick_len = i - tick_start;
            // Build the closing sequence as bytes (all backticks)
            let close_seq: Vec<u8> = vec![b'`'; tick_len];
            if let Some(rel) = line[i..]
                .as_bytes()
                .windows(tick_len)
                .position(|w| w == close_seq)
            {
                let end = i + rel + tick_len;
                out.push_str(&line[tick_start..end]);
                i = end;
            } else {
                // No closing sequence found; emit everything that was consumed
                out.push_str(&line[tick_start..i]);
            }
            continue;
        }

        // Detect ]( link/image URL spans and copy them verbatim.
        // Prevents ==foo== inside a URL like [x](url?a==1==2) from being converted.
        if bytes[i] == b']' && i + 1 < n && bytes[i + 1] == b'(' {
            let span_start = i;
            i += 2;
            let mut depth = 1i32;
            while i < n {
                match bytes[i] {
                    b'(' => { depth += 1; i += 1; }
                    b')' => {
                        depth -= 1;
                        i += 1;
                        if depth == 0 { break; }
                    }
                    b'\\' if i + 1 < n => { i += 2; }
                    _ => { i += 1; }
                }
            }
            out.push_str(&line[span_start..i]);
            continue;
        }

        // Check for ==highlight==
        if bytes[i] == b'=' && i + 1 < n && bytes[i + 1] == b'=' {
            let after_open = i + 2;
            // Find next == in the remaining line
            let rest = &line[after_open..];
            let rest_bytes = rest.as_bytes();
            let mut found = false;
            let mut j = 0;
            while j + 1 < rest_bytes.len() {
                if rest_bytes[j] == b'=' && rest_bytes[j + 1] == b'=' {
                    let inner = &rest[..j];
                    if !inner.is_empty() {
                        out.push_str("<mark>");
                        // HTML-escape inner content so that ==<script>== cannot inject raw HTML.
                        // DOMPurify in the frontend provides a second layer, but defence-in-depth
                        // requires the Rust layer to never emit unescaped user content.
                        out.push_str(&html_escape(inner));
                        out.push_str("</mark>");
                        i = after_open + j + 2;
                        found = true;
                    }
                    break;
                }
                j += 1;
            }
            if !found {
                out.push('=');
                i += 1;
            }
            continue;
        }

        // UTF-8-safe character advance
        let ch = line[i..].chars().next().unwrap_or('\0');
        out.push(ch);
        i += ch.len_utf8();
    }

    out
}

/// Sanitize HTML output, allowing safe formatting tags but stripping
/// dangerous elements like `<script>`, `<iframe>`, `<object>`, event handlers, etc.
/// Used for export paths where DOMPurify is not available.
pub fn sanitize_html(html: &str) -> String {
    ammonia::Builder::default()
        .add_tags(&["mark", "u", "s", "del", "ins", "sub", "sup", "details", "summary"])
        .clean(html)
        .to_string()
}

pub fn render_markdown(markdown: &str) -> String {
    let preprocessed = preprocess_highlight(markdown);
    let markdown = preprocessed.as_str();

    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_TASKLISTS);
    // Inline HTML is supported by default; keep it enabled for <mark> and <u>.

    let parser = Parser::new_ext(markdown, options);

    // Custom rendering to add heading IDs
    let mut html_output = String::new();
    let mut id_counts: HashMap<String, usize> = HashMap::new();
    let mut in_heading = false;
    let mut heading_level: Option<HeadingLevel> = None;
    // Plain text collected from heading — used only to generate the anchor ID.
    let mut heading_text = String::new();
    // Rendered HTML collected from all inline events inside the heading.
    // Avoids html_escape() on the whole content which would strip <mark> tags.
    let mut heading_inner_html = String::new();

    for event in parser {
        match &event {
            Event::Start(Tag::Heading { level, .. }) => {
                in_heading = true;
                heading_level = Some(*level);
                heading_text.clear();
                heading_inner_html.clear();
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some(level) = heading_level {
                    let id = generate_heading_id(&heading_text, &mut id_counts);
                    let level_num = match level {
                        HeadingLevel::H1 => 1,
                        HeadingLevel::H2 => 2,
                        HeadingLevel::H3 => 3,
                        HeadingLevel::H4 => 4,
                        HeadingLevel::H5 => 5,
                        HeadingLevel::H6 => 6,
                    };
                    html_output.push_str(&format!(
                        "<h{} id=\"{}\" data-heading-id=\"{}\">{}</h{}>\n",
                        level_num,
                        html_escape(&id),
                        html_escape(&id),
                        heading_inner_html,
                        level_num
                    ));
                }
                in_heading = false;
                heading_level = None;
            }
            Event::Text(text) | Event::Code(text) => {
                if in_heading {
                    // Accumulate plain text for ID generation; render HTML into the buffer.
                    heading_text.push_str(text);
                    html::push_html(&mut heading_inner_html, std::iter::once(event.clone()));
                } else {
                    html::push_html(&mut html_output, std::iter::once(event.clone()));
                }
            }
            _ => {
                if in_heading {
                    // Capture all other inline events (InlineHtml, emphasis, links…)
                    // so that <mark> tags inserted by preprocess_highlight survive.
                    html::push_html(&mut heading_inner_html, std::iter::once(event.clone()));
                } else {
                    html::push_html(&mut html_output, std::iter::once(event.clone()));
                }
            }
        }
    }

    html_output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_highlight_renders_as_mark() {
        let result = render_markdown("==hello world==");
        assert!(
            result.contains("<mark>hello world</mark>"),
            "expected <mark>hello world</mark> in output, got: {result}"
        );
    }

    #[test]
    fn test_highlight_inside_paragraph() {
        let result = render_markdown("This is ==highlighted== text.");
        assert!(
            result.contains("<mark>highlighted</mark>"),
            "expected <mark>highlighted</mark> in output, got: {result}"
        );
    }

    #[test]
    fn test_highlight_not_converted_inside_inline_code() {
        let result = render_markdown("`==hello==`");
        assert!(
            !result.contains("<mark>"),
            "== inside inline code should not become <mark>, got: {result}"
        );
        assert!(
            result.contains("==hello=="),
            "== inside inline code should be preserved verbatim, got: {result}"
        );
    }

    #[test]
    fn test_highlight_not_converted_inside_fenced_code_block() {
        let result = render_markdown("```\n==hello==\n```");
        assert!(
            !result.contains("<mark>"),
            "== inside fenced code block should not become <mark>, got: {result}"
        );
    }

    #[test]
    fn test_plain_text_unchanged() {
        let result = render_markdown("no highlights here");
        assert!(
            !result.contains("<mark>"),
            "plain text should not produce <mark>, got: {result}"
        );
    }

    #[test]
    fn test_multiple_highlights_on_same_line() {
        let result = render_markdown("==a== and ==b==");
        assert!(
            result.contains("<mark>a</mark>"),
            "expected <mark>a</mark> in output, got: {result}"
        );
        assert!(
            result.contains("<mark>b</mark>"),
            "expected <mark>b</mark> in output, got: {result}"
        );
    }

    // C1 regression: HTML in inner content must be escaped (XSS defence-in-depth)
    #[test]
    fn test_highlight_escapes_html_special_chars() {
        let result = render_markdown("==<script>alert(1)</script>==");
        assert!(
            !result.contains("<script>"),
            "raw <script> must not appear in output, got: {result}"
        );
        assert!(
            result.contains("&lt;script&gt;"),
            "expected escaped &lt;script&gt; in output, got: {result}"
        );
    }

    // H1 regression: == inside a link URL must not be converted
    #[test]
    fn test_highlight_not_converted_inside_link_url() {
        let result = render_markdown("[text](url?a==1==2)");
        assert!(
            !result.contains("<mark>"),
            "== in link URL should not become <mark>, got: {result}"
        );
    }

    // H2 regression: 4-space indented code blocks must be left alone
    #[test]
    fn test_highlight_not_converted_in_indented_code_block() {
        let result = render_markdown("    ==hello==");
        assert!(
            !result.contains("<mark>"),
            "== in 4-space indented code block should not become <mark>, got: {result}"
        );
    }

    // #182 regression: CRLF line endings must not break highlight rendering
    #[test]
    fn test_highlight_renders_correctly_with_crlf() {
        let result = render_markdown("==hello==\r\nworld");
        assert!(
            result.contains("<mark>hello</mark>"),
            "expected <mark>hello</mark> with CRLF input, got: {result}"
        );
    }

    // #246: sanitize_html strips dangerous tags but keeps safe formatting
    #[test]
    fn test_sanitize_strips_script_tags() {
        let html = "<p>Hello</p><script>alert(1)</script><p>World</p>";
        let result = sanitize_html(html);
        assert!(!result.contains("<script>"), "script tag must be stripped, got: {result}");
        assert!(result.contains("Hello"), "safe content must survive, got: {result}");
        assert!(result.contains("World"), "safe content must survive, got: {result}");
    }

    #[test]
    fn test_sanitize_strips_iframe() {
        let html = "<p>Text</p><iframe src=\"evil.com\"></iframe>";
        let result = sanitize_html(html);
        assert!(!result.contains("<iframe"), "iframe must be stripped, got: {result}");
    }

    #[test]
    fn test_sanitize_strips_event_handlers() {
        let html = "<img src=\"x\" onerror=\"alert(1)\">";
        let result = sanitize_html(html);
        assert!(!result.contains("onerror"), "event handlers must be stripped, got: {result}");
    }

    #[test]
    fn test_sanitize_preserves_mark_tags() {
        let html = "<p>This is <mark>highlighted</mark> text</p>";
        let result = sanitize_html(html);
        assert!(result.contains("<mark>"), "mark tags must survive sanitization, got: {result}");
    }

    #[test]
    fn test_sanitize_preserves_standard_formatting() {
        let html = "<p><strong>bold</strong> <em>italic</em> <u>underline</u> <s>strike</s></p>";
        let result = sanitize_html(html);
        assert!(result.contains("<strong>"), "strong must survive, got: {result}");
        assert!(result.contains("<em>"), "em must survive, got: {result}");
        assert!(result.contains("<u>"), "u must survive, got: {result}");
        assert!(result.contains("<s>"), "s must survive, got: {result}");
    }

    #[test]
    fn test_sanitize_end_to_end_with_render() {
        let md = "# Hello\n\n<script>alert('xss')</script>\n\n==highlighted==";
        let html = render_markdown(md);
        let safe = sanitize_html(&html);
        assert!(!safe.contains("<script>"), "script must not appear in sanitized render output, got: {safe}");
        assert!(safe.contains("<mark>"), "mark from highlight must survive, got: {safe}");
        assert!(safe.contains("Hello"), "heading text must survive, got: {safe}");
    }

    // H3 regression: ==highlight== inside a heading must render as <mark>
    #[test]
    fn test_highlight_inside_heading_renders_mark() {
        let result = render_markdown("# ==title==");
        assert!(
            result.contains("<mark>"),
            "expected <mark> tag in heading, got: {result}"
        );
        assert!(
            result.contains("id=\"title\""),
            "heading anchor id should be plain text 'title', got: {result}"
        );
    }
}
