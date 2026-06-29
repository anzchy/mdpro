use pulldown_cmark::{html, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use std::collections::HashMap;

use crate::services::markdown_ext::{
    add_footnote_back_links, preprocess_autolink_and_emoji, render_display_math, render_inline_math,
};

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
            let close_len = trimmed.chars().take_while(|&c| c == fence_char).count();
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
                    b'\\' if i + 1 < n => {
                        i += 2;
                    }
                    _ => {
                        i += 1;
                    }
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

// ---------------------------------------------------------------------------
// WI-0.1 — Sanitizer allow-list matrix
//
// One authoritative, per-feature definition shared by both render surfaces.
// The Rust side (`sanitize_html`, below) consumes these lists directly; the
// frontend DOMPurify config (`src/services/sanitizerPolicy.ts`) mirrors them
// with an explicit allow-list and is regression-tested against this set (see
// tests/sanitizer-policy.test.ts, tests/sanitizer-malicious-fixtures.test.ts,
// and tests/sanitizer-rust-js-parity.test.ts — the parity test reads these
// constants and the `url_schemes` set below and asserts the JS sets match).
//
// Risk controls baked in:
// - `style` attribute is never allowed → no `url(http…)` exfiltration.
// - `href`/`src` schemes are restricted to a safe-scheme allow-list (relative,
//   http, https, mailto, tel, ftp). `javascript:`, `data:`, `vbscript:` and
//   every other scheme are dropped.
//
//   Honest deviation note: this allow-list is NOT in-doc-only. http/https are
//   allowed body-wide, so a footnote/anchor href OR an SVG `<a href>` CAN carry
//   `http://example.com` (and therefore a tracker URL). We accept this because
//   `sanitize_html` runs over the whole exported document and forbidding
//   http/https would silently strip legitimate body links the user wrote.
//   `link_rel("noopener noreferrer")` hardens any external link, and the XSS
//   controls (no `style`, no `on*`, no `<script>`) do not depend on the scheme
//   set being in-doc-only. The trade-off is "no off-document navigation" for
//   "external links work" — links are a core editor feature, tracker pixels via
//   `<a>` are a non-issue (a click, not an auto-load), and `<img src>` auto-load
//   is governed by the same safe-scheme list, not by an in-doc restriction.
// - `<script>`, `on*` handlers, `<foreignObject>` are stripped by ammonia's
//   default deny posture (only the tags below are allowed through).
// ---------------------------------------------------------------------------

/// Math (KaTeX HTML + MathML) tags.
pub const MATH_TAGS: &[&str] = &[
    "math",
    "semantics",
    "annotation",
    "mrow",
    "mi",
    "mo",
    "mn",
    "ms",
    "mtext",
    "msup",
    "msub",
    "msubsup",
    "mfrac",
    "msqrt",
    "mroot",
    "munder",
    "mover",
    "munderover",
    "mtable",
    "mtr",
    "mtd",
    "mspace",
    "mpadded",
    "mphantom",
    "menclose",
    "mstyle",
    "merror",
    "annotation-xml",
];

/// Mermaid / inline-SVG diagram tags (specific SVG profile — no foreignObject,
/// no script, no event-handler-bearing wrappers).
pub const SVG_TAGS: &[&str] = &[
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "defs",
    "marker",
    "use",
    "symbol",
    "title",
    "desc",
    "clipPath",
    "linearGradient",
    "radialGradient",
    "stop",
    "pattern",
];

/// Generic SVG presentation/geometry attributes that carry no script surface.
pub const SVG_ATTRS: &[&str] = &[
    "d",
    "viewBox",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "points",
    "transform",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-linecap",
    "stroke-linejoin",
    "fill-opacity",
    "stroke-opacity",
    "opacity",
    "offset",
    "stop-color",
    "gradientUnits",
    "gradientTransform",
    "marker-end",
    "marker-start",
    "text-anchor",
    "dominant-baseline",
    "font-size",
    "font-family",
    "preserveAspectRatio",
    "xmlns",
    "class",
    "id",
    "dx",
    "dy",
];

/// Sanitize HTML output, allowing safe formatting tags but stripping
/// dangerous elements like `<script>`, `<iframe>`, `<object>`, event handlers, etc.
/// Used for export paths where DOMPurify is not available.
///
/// The allow-list is widened per the WI-0.1 matrix to preserve legitimate
/// KaTeX math, footnote anchors, and Mermaid SVG, while the script-injection
/// and url()-exfiltration vectors stay neutralized.
pub fn sanitize_html(html: &str) -> String {
    let mut builder = ammonia::Builder::default();
    builder
        .add_tags(&[
            "mark", "u", "s", "del", "ins", "sub", "sup", "details", "summary", "input", "section",
        ])
        .add_tags(MATH_TAGS)
        .add_tags(SVG_TAGS)
        // `class` is needed by KaTeX (`katex-*`) and footnote/mermaid wrappers.
        // It carries no script surface once `style` and `on*` stay disallowed.
        // `aria-label`/`aria-hidden` are screen-reader hints (footnote back-link,
        // KaTeX MathML) and carry no script surface.
        .add_generic_attributes(&["id", "class", "aria-label", "aria-hidden"])
        .add_tag_attributes("h1", &["data-heading-id"])
        .add_tag_attributes("h2", &["data-heading-id"])
        .add_tag_attributes("h3", &["data-heading-id"])
        .add_tag_attributes("h4", &["data-heading-id"])
        .add_tag_attributes("h5", &["data-heading-id"])
        .add_tag_attributes("h6", &["data-heading-id"])
        .add_tag_attributes("input", &["type", "checked", "disabled"])
        .add_tag_attributes("math", &["xmlns", "display"])
        .add_tag_attributes("annotation", &["encoding"])
        .add_tag_attributes("annotation-xml", &["encoding"])
        .add_tag_attributes("span", &["aria-hidden"]);
    for tag in SVG_TAGS {
        builder.add_tag_attributes(tag, SVG_ATTRS);
    }
    // Link schemes: allow only the safe set. `javascript:`, `data:`, `vbscript:`
    // and any other scheme are dropped. In-doc anchors (`#fn1`) pass through via
    // `url_relative`. `link_rel` hardens any surviving external link.
    //
    // Deviation note (vs the WI-0.1 matrix "footnote href restricted to in-doc
    // anchors only"): ammonia cannot scope schemes per-parent, and the same
    // `sanitize_html` runs on the whole export — forbidding http/https outright
    // would silently drop legitimate body links from exported HTML. We instead
    // keep the safe-scheme allow-list (matching the frontend DOMPurify default)
    // and rely on no-`style` / no-`on*` / no-`<script>` for the XSS controls.
    builder
        .url_relative(ammonia::UrlRelative::PassThrough)
        .link_rel(Some("noopener noreferrer"))
        .url_schemes(
            ["http", "https", "mailto", "tel", "ftp"]
                .into_iter()
                .collect(),
        );
    builder.clean(html).to_string()
}

/// Parse `{mdpro-width=N%}` (1-200) from a title attribute value; returns
/// the percentage and the title with the marker (and a single leading space)
/// stripped.
fn extract_image_width_marker(title: &str) -> Option<(u32, String)> {
    let marker_start = title.rfind("{mdpro-width=")?;
    let after = &title[marker_start + "{mdpro-width=".len()..];
    let close_rel = after.find("%}")?;
    let percent: u32 = after[..close_rel].parse().ok()?;
    if !(1..=200).contains(&percent) {
        return None;
    }
    let mut left = &title[..marker_start];
    if left.ends_with(' ') {
        left = &left[..left.len() - 1];
    }
    let right = &after[close_rel + "%}".len()..];
    let cleaned = format!("{}{}", left, right).trim().to_string();
    Some((percent, cleaned))
}

/// Strip mdpro width markers from `<img>` title attributes and convert them
/// into inline `style` attributes. Operates on the rendered HTML so the same
/// logic applies regardless of which markdown parser produced the tag.
fn apply_image_width_marker(html: String) -> String {
    if !html.contains("{mdpro-width=") {
        return html;
    }
    let mut result = String::with_capacity(html.len());
    let mut rest = html.as_str();
    while let Some(idx) = rest.find("<img ") {
        result.push_str(&rest[..idx]);
        let tail = &rest[idx..];
        match tail.find('>') {
            Some(end) => {
                let tag = &tail[..=end];
                result.push_str(&rewrite_img_tag(tag));
                rest = &tail[end + 1..];
            }
            None => {
                result.push_str(tail);
                rest = "";
            }
        }
    }
    result.push_str(rest);
    result
}

fn rewrite_img_tag(tag: &str) -> String {
    let title_key = "title=\"";
    let Some(title_start) = tag.find(title_key) else {
        return tag.to_string();
    };
    let value_start = title_start + title_key.len();
    let Some(rel_end) = tag[value_start..].find('"') else {
        return tag.to_string();
    };
    let title_value_end = value_start + rel_end;
    let title_value = &tag[value_start..title_value_end];

    let Some((percent, cleaned_title)) = extract_image_width_marker(title_value) else {
        return tag.to_string();
    };

    // Rebuild attributes:
    // - drop the title attribute when cleaned title is empty
    // - otherwise replace the value (already HTML-escaped by pulldown-cmark; do
    //   not double-escape)
    // - append `width="N%"` before the closing `>` / `/>`. Use the HTML width
    //   attribute (universally supported by browsers, preserved by the
    //   ammonia default sanitizer used in `export_html`) instead of `style`,
    //   which the sanitizer would otherwise strip.
    let mut head = String::with_capacity(tag.len() + 32);
    head.push_str(&tag[..title_start]);
    if cleaned_title.is_empty() {
        let after_title = &tag[title_value_end + 1..];
        let trimmed = after_title.strip_prefix(' ').unwrap_or(after_title);
        head.push_str(trimmed);
    } else {
        head.push_str(title_key);
        head.push_str(&cleaned_title);
        head.push('"');
        head.push_str(&tag[title_value_end + 1..]);
    }

    let extra = format!(" width=\"{}%\"", percent);
    let trimmed = head.trim_end();
    if let Some(stripped) = trimmed.strip_suffix("/>") {
        format!("{}{} />", stripped.trim_end(), extra)
    } else if let Some(stripped) = trimmed.strip_suffix('>') {
        format!("{}{}>", stripped.trim_end(), extra)
    } else {
        head
    }
}

pub fn render_markdown(markdown: &str) -> String {
    // WI-1.4: autolink bare URLs + replace known emoji shortcodes first (both
    // skip code), then the highlight (`==`) pass. Order matters only in that
    // both skip code spans/fences identically, so they compose safely.
    let linked = preprocess_autolink_and_emoji(markdown);
    let preprocessed = preprocess_highlight(&linked);
    let markdown = preprocessed.as_str();

    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_TASKLISTS);
    // WI-1.1: math events (`$…$`, `$$…$$`). Math inside code spans / fences is
    // NOT emitted as a math event by pulldown-cmark, so it never renders.
    options.insert(Options::ENABLE_MATH);
    // WI-1.3: footnotes (`[^1]`). Back-link rewrite happens post-render.
    options.insert(Options::ENABLE_FOOTNOTES);
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
    // Tables are stateful in pulldown-cmark's HTML writer (alignments,
    // <thead>/<tbody>, <th>/<td>). Calling html::push_html per event drops
    // that state — buffer all events between Tag::Start(Table) and
    // TagEnd::Table and emit them in one push_html call so the writer's
    // internal state survives.
    let mut in_table = false;
    let mut table_events: Vec<Event<'_>> = Vec::new();

    for event in parser {
        match &event {
            Event::Start(Tag::Table(_)) => {
                in_table = true;
                table_events.push(event);
            }
            Event::End(TagEnd::Table) => {
                table_events.push(event);
                // Audit fix Low: render the table to a scratch buffer,
                // run apply_table_alignment on that buffer only, then
                // append. This restricts the substring rewrite to
                // pulldown-cmark's table output and prevents false
                // positives if a user authors a raw `<td style="…">`
                // tag in inline HTML elsewhere in the document.
                let mut table_html = String::new();
                html::push_html(&mut table_html, table_events.drain(..));
                let rewritten = apply_table_alignment(table_html);
                let target = if in_heading {
                    &mut heading_inner_html
                } else {
                    &mut html_output
                };
                target.push_str(&rewritten);
                in_table = false;
            }
            Event::Start(Tag::Heading { level, .. }) if !in_table => {
                in_heading = true;
                heading_level = Some(*level);
                heading_text.clear();
                heading_inner_html.clear();
            }
            Event::End(TagEnd::Heading(_)) if !in_table => {
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
            Event::Text(text) | Event::Code(text) if !in_table => {
                if in_heading {
                    // Accumulate plain text for ID generation; render HTML into the buffer.
                    heading_text.push_str(text);
                    html::push_html(&mut heading_inner_html, std::iter::once(event.clone()));
                } else {
                    html::push_html(&mut html_output, std::iter::once(event.clone()));
                }
            }
            // WI-1.1: emit mdpro's math wrappers (carrying raw, HTML-escaped
            // TeX) instead of pulldown-cmark's default `math math-inline` span,
            // which the KaTeX render pass keys off. Inside a heading the wrapper
            // still goes to the inner-html buffer; the TeX is NOT added to
            // heading_text so it doesn't pollute the anchor id.
            Event::InlineMath(tex) if !in_table => {
                let rendered = render_inline_math(tex);
                if in_heading {
                    heading_inner_html.push_str(&rendered);
                } else {
                    html_output.push_str(&rendered);
                }
            }
            Event::DisplayMath(tex) if !in_table => {
                let rendered = render_display_math(tex);
                if in_heading {
                    heading_inner_html.push_str(&rendered);
                } else {
                    html_output.push_str(&rendered);
                }
            }
            _ => {
                if in_table {
                    table_events.push(event);
                } else if in_heading {
                    // Capture all other inline events (InlineHtml, emphasis, links…)
                    // so that <mark> tags inserted by preprocess_highlight survive.
                    html::push_html(&mut heading_inner_html, std::iter::once(event.clone()));
                } else {
                    html::push_html(&mut html_output, std::iter::once(event.clone()));
                }
            }
        }
    }

    // Image width marker is image-only and stays a fragment-wide rewrite.
    // Table alignment is applied per-table inside the loop above (see
    // the End(Table) branch) so it never touches inline HTML outside
    // pulldown-cmark's own table output.
    let with_images = apply_image_width_marker(html_output);
    // WI-1.3: add return anchors to footnote definitions (pulldown-cmark's
    // default writer does not emit them).
    add_footnote_back_links(&with_images)
}

/// Convert `<th style="text-align: X">` / `<td style="text-align: X">` to
/// `<th align="X">` / `<td align="X">`. Background:
///
/// pulldown-cmark emits `style="text-align: …"` on aligned table cells.
/// `ammonia::Builder::default()` (used by `sanitize_html`) does NOT keep
/// the `style` attribute — alignment would silently disappear from the
/// exported HTML and from the in-app preview.
///
/// The HTML4 `align` attribute on `td` / `th` is allowed by ammonia's
/// default config and is honored by every modern browser. Combined with
/// CSS `[align="…"]` selectors in the three render-pipeline stylesheets,
/// alignment renders correctly across WYSIWYG, Preview, and exported HTML.
fn apply_table_alignment(html: String) -> String {
    if !html.contains("style=\"text-align:") {
        return html;
    }

    // Run two targeted replacements per direction. The substring is precise
    // (`<th style="text-align: X">` / `<td style="text-align: X">`) and only
    // appears in pulldown-cmark's table-cell output, so substring match is
    // safe — `style="text-align: …"` could appear elsewhere in inline HTML
    // but pulldown-cmark always uses double quotes and exactly this prefix
    // for table cells.
    let mut out = html;
    for tag in ["th", "td"] {
        for (align, attr) in [("left", "left"), ("center", "center"), ("right", "right")] {
            let from = format!("<{tag} style=\"text-align: {align}\">");
            let to = format!("<{tag} align=\"{attr}\">");
            out = out.replace(&from, &to);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_table_alignment_rewrite_does_not_touch_raw_inline_html() {
        // Audit fix Low: raw inline HTML outside pulldown-cmark's table
        // output must NOT be rewritten by apply_table_alignment. The
        // table rewrite is now scoped to the per-table buffer.
        //
        // Inline HTML blocks in markdown pass through pulldown-cmark
        // verbatim — if a user authors `<td style="text-align: center">`
        // outside a real table, the `style` attribute should survive
        // (or be stripped by ammonia later, but not converted to align).
        let md = "<p>Code: <code>&lt;td style=\"text-align: center\"&gt;</code></p>\n";
        let html = render_markdown(md);
        assert!(
            !html.contains("align=\"center\""),
            "raw HTML in escaped code span must not be rewritten, got: {html}"
        );
    }

    #[test]
    fn test_table_alignment_renders_align_attr() {
        // pulldown-cmark emits style="text-align: …" by default; mdpro
        // converts to the HTML align="…" attribute so the value survives
        // ammonia's default sanitizer (which strips style attributes).
        let md = "| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n";
        let html = render_markdown(md);
        assert!(
            html.contains("align=\"left\""),
            "expected align=\"left\" on left-aligned column, got: {html}"
        );
        assert!(
            html.contains("align=\"center\""),
            "expected align=\"center\" on center-aligned column, got: {html}"
        );
        assert!(
            html.contains("align=\"right\""),
            "expected align=\"right\" on right-aligned column, got: {html}"
        );
        assert!(
            !html.contains("style=\"text-align"),
            "style=\"text-align: …\" must be rewritten to align=\"…\", got: {html}"
        );
    }

    #[test]
    fn test_table_alignment_survives_sanitize_html() {
        // The export_html path runs sanitize_html on the rendered fragment.
        // ammonia's default builder keeps the align attribute on td/th but
        // strips style — verify the rewritten output passes through intact.
        let md = "| a | b |\n|:-:|--:|\n| 1 | 2 |\n";
        let html = render_markdown(md);
        let sanitized = sanitize_html(&html);
        assert!(
            sanitized.contains("align=\"center\""),
            "alignment lost after sanitize, got: {sanitized}"
        );
        assert!(
            sanitized.contains("align=\"right\""),
            "alignment lost after sanitize, got: {sanitized}"
        );
    }

    #[test]
    fn test_table_without_alignment_has_no_align_attr() {
        let md = "| a | b |\n|---|---|\n| 1 | 2 |\n";
        let html = render_markdown(md);
        // Default-aligned columns (the |---| form, no colon) should not
        // emit an align attribute — preserves browser default behavior.
        assert!(
            !html.contains("align=\""),
            "no align attribute expected for default columns, got: {html}"
        );
    }

    #[test]
    fn test_image_width_marker_rewrites_to_width_attr() {
        let html = render_markdown("![diagram](a.png \"caption {mdpro-width=50%}\")");
        assert!(
            !html.contains("{mdpro-width="),
            "marker should be stripped from rendered HTML, got: {html}"
        );
        assert!(html.contains("title=\"caption\""), "got: {html}");
        assert!(html.contains("width=\"50%\""), "got: {html}");
    }

    #[test]
    fn test_image_width_marker_drops_empty_title() {
        let html = render_markdown("![alt](a.png \"{mdpro-width=75%}\")");
        assert!(
            !html.contains("title="),
            "title should be removed, got: {html}"
        );
        assert!(html.contains("width=\"75%\""), "got: {html}");
    }

    #[test]
    fn test_image_width_marker_ignores_out_of_range() {
        let html = render_markdown("![alt](a.png \"caption {mdpro-width=500%}\")");
        // Out-of-range value: leave the rendered HTML untouched.
        assert!(html.contains("{mdpro-width=500%}"), "got: {html}");
        assert!(!html.contains("width=\""), "got: {html}");
    }

    #[test]
    fn test_image_without_marker_is_unchanged() {
        let html = render_markdown("![alt](a.png \"caption\")");
        assert!(html.contains("title=\"caption\""), "got: {html}");
        assert!(!html.contains("width=\""), "got: {html}");
    }

    #[test]
    fn test_image_width_marker_does_not_double_escape_title() {
        // pulldown-cmark already HTML-escapes the title; the rewriter must
        // not re-escape it.
        let html = render_markdown("![alt](a.png \"A & B {mdpro-width=50%}\")");
        assert!(html.contains("title=\"A &amp; B\""), "got: {html}");
        assert!(!html.contains("&amp;amp;"), "got: {html}");
    }

    #[test]
    fn test_image_width_marker_survives_sanitize_html() {
        // export_html runs sanitize_html on the rendered fragment; verify the
        // resize survives. ammonia's default sanitizer strips `style` but
        // preserves the `width` attribute on <img>.
        let html = render_markdown("![alt](a.png \"cap {mdpro-width=50%}\")");
        let safe = sanitize_html(&html);
        assert!(safe.contains("width=\"50%\""), "got: {safe}");
        assert!(!safe.contains("{mdpro-width="), "got: {safe}");
    }

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
        assert!(
            !result.contains("<script>"),
            "script tag must be stripped, got: {result}"
        );
        assert!(
            result.contains("Hello"),
            "safe content must survive, got: {result}"
        );
        assert!(
            result.contains("World"),
            "safe content must survive, got: {result}"
        );
    }

    #[test]
    fn test_sanitize_strips_iframe() {
        let html = "<p>Text</p><iframe src=\"evil.com\"></iframe>";
        let result = sanitize_html(html);
        assert!(
            !result.contains("<iframe"),
            "iframe must be stripped, got: {result}"
        );
    }

    #[test]
    fn test_sanitize_strips_event_handlers() {
        let html = "<img src=\"x\" onerror=\"alert(1)\">";
        let result = sanitize_html(html);
        assert!(
            !result.contains("onerror"),
            "event handlers must be stripped, got: {result}"
        );
    }

    #[test]
    fn test_sanitize_preserves_mark_tags() {
        let html = "<p>This is <mark>highlighted</mark> text</p>";
        let result = sanitize_html(html);
        assert!(
            result.contains("<mark>"),
            "mark tags must survive sanitization, got: {result}"
        );
    }

    #[test]
    fn test_sanitize_preserves_standard_formatting() {
        let html = "<p><strong>bold</strong> <em>italic</em> <u>underline</u> <s>strike</s></p>";
        let result = sanitize_html(html);
        assert!(
            result.contains("<strong>"),
            "strong must survive, got: {result}"
        );
        assert!(result.contains("<em>"), "em must survive, got: {result}");
        assert!(result.contains("<u>"), "u must survive, got: {result}");
        assert!(result.contains("<s>"), "s must survive, got: {result}");
    }

    #[test]
    fn test_sanitize_end_to_end_with_render() {
        let md = "# Hello\n\n<script>alert('xss')</script>\n\n==highlighted==";
        let html = render_markdown(md);
        let safe = sanitize_html(&html);
        assert!(
            !safe.contains("<script>"),
            "script must not appear in sanitized render output, got: {safe}"
        );
        assert!(
            safe.contains("<mark>"),
            "mark from highlight must survive, got: {safe}"
        );
        assert!(
            safe.contains("Hello"),
            "heading text must survive, got: {safe}"
        );
        assert!(
            safe.contains("id=\"hello\""),
            "heading id must survive sanitization, got: {safe}"
        );
    }

    #[test]
    fn test_sanitize_preserves_heading_ids() {
        let html = "<h2 id=\"my-heading\" data-heading-id=\"my-heading\">My Heading</h2>";
        let result = sanitize_html(html);
        assert!(
            result.contains("id=\"my-heading\""),
            "id attr must survive, got: {result}"
        );
        assert!(
            result.contains("data-heading-id=\"my-heading\""),
            "data-heading-id must survive, got: {result}"
        );
    }

    #[test]
    fn test_sanitize_preserves_task_list_checkboxes() {
        let md = "- [x] Done\n- [ ] Todo";
        let html = render_markdown(md);
        let safe = sanitize_html(&html);
        assert!(
            safe.contains("<input"),
            "task list checkbox must survive, got: {safe}"
        );
        assert!(
            safe.contains("checked"),
            "checked attr must survive, got: {safe}"
        );
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

    // -----------------------------------------------------------------------
    // WI-0.1 — Sanitizer policy redesign
    //
    // The allow-list is widened to preserve legitimate KaTeX math, footnote
    // anchors, and Mermaid SVG output, while the script-injection payloads
    // embedded in each surface stay neutralized. See the "Sanitizer Policy"
    // matrix in docs/plans/20260628-plan-typora-parity.md.
    // -----------------------------------------------------------------------

    // --- Legitimate output must survive ---

    #[test]
    fn test_sanitize_preserves_katex_math_markup() {
        // Representative KaTeX HTML+MathML output for an inline expression.
        let html = concat!(
            "<span class=\"katex\"><span class=\"katex-mathml\">",
            "<math xmlns=\"http://www.w3.org/1998/Math/MathML\"><semantics>",
            "<mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow>",
            "<annotation encoding=\"application/x-tex\">x+1</annotation>",
            "</semantics></math></span>",
            "<span class=\"katex-html\" aria-hidden=\"true\">",
            "<span class=\"base\"><span class=\"mord mathnormal\">x</span></span>",
            "</span></span>",
        );
        let result = sanitize_html(html);
        assert!(
            result.contains("<math"),
            "math element must survive, got: {result}"
        );
        assert!(
            result.contains("<semantics>"),
            "semantics must survive, got: {result}"
        );
        assert!(
            result.contains("<annotation"),
            "annotation must survive, got: {result}"
        );
        assert!(
            result.contains("<mi>x</mi>"),
            "mi must survive, got: {result}"
        );
        assert!(
            result.contains("class=\"katex\""),
            "katex class must survive, got: {result}"
        );
    }

    #[test]
    fn test_sanitize_preserves_footnote_anchors() {
        // pulldown-cmark footnote reference + definition shape.
        let html = concat!(
            "<sup class=\"footnote-reference\"><a href=\"#fn1\">1</a></sup>",
            "<div class=\"footnote-definition\" id=\"fn1\">",
            "<sup class=\"footnote-definition-label\">1</sup>",
            "<p>The note. <a href=\"#fnref1\">↩</a></p></div>",
        );
        let result = sanitize_html(html);
        assert!(
            result.contains("href=\"#fn1\""),
            "in-doc footnote href must survive, got: {result}"
        );
        assert!(
            result.contains("id=\"fn1\""),
            "footnote id must survive, got: {result}"
        );
        assert!(
            result.contains("class=\"footnote-reference\""),
            "footnote class must survive, got: {result}"
        );
    }

    #[test]
    fn test_sanitize_preserves_mermaid_svg() {
        let html = concat!(
            "<svg viewBox=\"0 0 100 100\" class=\"mermaid\">",
            "<g><path d=\"M0 0 L10 10\"></path>",
            "<text x=\"5\" y=\"5\">node</text></g></svg>",
        );
        let result = sanitize_html(html);
        assert!(result.contains("<svg"), "svg must survive, got: {result}");
        assert!(result.contains("<path"), "path must survive, got: {result}");
        assert!(
            result.contains("d=\"M0 0 L10 10\""),
            "path data must survive, got: {result}"
        );
        assert!(
            result.contains("viewBox="),
            "viewBox must survive, got: {result}"
        );
        assert!(result.contains("<text"), "text must survive, got: {result}");
    }

    // --- Script-injection payloads must be neutralized on each surface ---

    #[test]
    fn test_sanitize_neutralizes_script_in_math_markup() {
        let html = concat!(
            "<span class=\"katex\"><math><semantics>",
            "<annotation><script>alert(1)</script></annotation>",
            "</semantics></math></span>",
        );
        let result = sanitize_html(html);
        assert!(
            !result.contains("<script"),
            "script in math must be stripped, got: {result}"
        );
        assert!(
            !result.contains("alert(1)") || !result.contains("<script"),
            "script payload must not execute, got: {result}"
        );
    }

    #[test]
    fn test_sanitize_neutralizes_javascript_href_in_footnote() {
        // A footnote/anchor href with a dangerous scheme must be dropped.
        // (Per the deviation note in sanitize_html, http/https body links are
        // kept so exported documents don't lose legitimate links; the security
        // control is the scheme allow-list, not an in-doc-only restriction.)
        let html = "<sup><a href=\"javascript:alert(1)\">1</a></sup>";
        let result = sanitize_html(html);
        assert!(
            !result.contains("javascript:"),
            "javascript: footnote href must be stripped, got: {result}"
        );
    }

    #[test]
    fn test_sanitize_keeps_in_doc_footnote_anchor() {
        let html = "<sup><a href=\"#fn1\">1</a></sup>";
        let result = sanitize_html(html);
        assert!(
            result.contains("href=\"#fn1\""),
            "in-doc footnote anchor must survive, got: {result}"
        );
    }

    #[test]
    fn test_sanitize_neutralizes_script_in_mermaid_svg() {
        let html = concat!(
            "<svg viewBox=\"0 0 10 10\"><script>alert(1)</script>",
            "<path d=\"M0 0\" onload=\"alert(2)\"></path>",
            "<foreignObject><iframe src=\"javascript:alert(3)\"></iframe></foreignObject>",
            "</svg>",
        );
        let result = sanitize_html(html);
        assert!(
            !result.contains("<script"),
            "script in svg must be stripped, got: {result}"
        );
        assert!(
            !result.contains("onload"),
            "event handler in svg must be stripped, got: {result}"
        );
        assert!(
            !result.contains("<foreignObject"),
            "foreignObject (HTML-in-SVG escape hatch) must be stripped, got: {result}"
        );
        assert!(
            !result.contains("<iframe"),
            "iframe in svg must be stripped, got: {result}"
        );
    }

    #[test]
    fn test_sanitize_neutralizes_url_with_http_in_style() {
        // No style attribute carrying url(http…) may survive (exfiltration vector).
        let html = "<span class=\"katex\" style=\"background:url(http://evil.example/x)\">x</span>";
        let result = sanitize_html(html);
        assert!(
            !result.contains("evil.example"),
            "url() exfiltration in style must be stripped, got: {result}"
        );
    }

    // -----------------------------------------------------------------------
    // WI-1.1 — Math / LaTeX through render_markdown
    // -----------------------------------------------------------------------

    #[test]
    fn test_render_inline_math() {
        let html = render_markdown("The value is $x^2 + 1$ today.");
        assert!(
            html.contains("<span class=\"math-inline\">x^2 + 1</span>"),
            "expected inline math wrapper, got: {html}"
        );
    }

    #[test]
    fn test_render_display_math() {
        let html = render_markdown("$$\\int_0^1 x\\,dx$$");
        assert!(
            html.contains("<div class=\"math-display\">"),
            "expected display math wrapper, got: {html}"
        );
        assert!(
            html.contains("\\int_0^1"),
            "raw tex must survive, got: {html}"
        );
    }

    #[test]
    fn test_render_escaped_dollar_is_not_math() {
        // An escaped \$ must render as a literal $, NOT open a math span.
        let html = render_markdown("Price is \\$5 and \\$10.");
        assert!(
            !html.contains("class=\"math-inline\""),
            "escaped \\$ must not render as math, got: {html}"
        );
        assert!(
            html.contains("$5"),
            "literal dollar must survive, got: {html}"
        );
    }

    #[test]
    fn test_math_inside_code_fence_does_not_render() {
        let html = render_markdown("```\n$x^2$\n```");
        assert!(
            !html.contains("class=\"math-inline\""),
            "math inside a code fence must NOT render, got: {html}"
        );
        assert!(
            html.contains("$x^2$"),
            "literal tex must survive in code, got: {html}"
        );
    }

    #[test]
    fn test_math_inside_inline_code_does_not_render() {
        let html = render_markdown("`$x^2$`");
        assert!(
            !html.contains("class=\"math-inline\""),
            "math inside inline code must NOT render, got: {html}"
        );
    }

    #[test]
    fn test_math_survives_sanitize_html() {
        let html = render_markdown("Inline $a+b$ and $$c+d$$");
        let safe = sanitize_html(&html);
        assert!(
            safe.contains("class=\"math-inline\""),
            "inline math wrapper must survive sanitize, got: {safe}"
        );
        assert!(
            safe.contains("class=\"math-display\""),
            "display math wrapper must survive sanitize, got: {safe}"
        );
    }

    // -----------------------------------------------------------------------
    // WI-1.3 — Footnotes through render_markdown
    // -----------------------------------------------------------------------

    #[test]
    fn test_render_single_footnote_with_backlink() {
        let md = "Here is a note[^1].\n\n[^1]: The footnote text.";
        let html = render_markdown(md);
        assert!(
            html.contains("class=\"footnote-reference\""),
            "footnote reference missing, got: {html}"
        );
        assert!(
            html.contains("class=\"footnote-definition\""),
            "footnote definition missing, got: {html}"
        );
        assert!(
            html.contains("id=\"fnref-1\""),
            "reference back-link target id missing, got: {html}"
        );
        assert!(
            html.contains("href=\"#fnref-1\""),
            "definition back-link missing, got: {html}"
        );
    }

    #[test]
    fn test_render_multiple_footnotes() {
        let md = "A[^a] and B[^b].\n\n[^a]: first\n[^b]: second";
        let html = render_markdown(md);
        assert!(html.contains("id=\"fnref-a\""), "got: {html}");
        assert!(html.contains("id=\"fnref-b\""), "got: {html}");
        assert!(html.contains("href=\"#fnref-a\""), "got: {html}");
        assert!(html.contains("href=\"#fnref-b\""), "got: {html}");
    }

    #[test]
    fn test_render_undefined_footnote_reference() {
        // A reference with no matching definition must not crash and must not
        // emit a dangling back-link (no definition exists to link from).
        let md = "Dangling[^missing] reference.";
        let html = render_markdown(md);
        // pulldown-cmark still emits the reference; the rewrite gives it an id
        // but there is no definition, so no back-link anchor is produced.
        assert!(
            !html.contains("footnote-backref"),
            "no back-link without a definition, got: {html}"
        );
    }

    #[test]
    fn test_footnote_backlink_survives_sanitize() {
        let md = "Note[^1].\n\n[^1]: text";
        let html = render_markdown(md);
        let safe = sanitize_html(&html);
        assert!(
            safe.contains("href=\"#fnref-1\""),
            "back-link href must survive sanitize, got: {safe}"
        );
        assert!(
            safe.contains("class=\"footnote-backref\""),
            "back-link class must survive sanitize, got: {safe}"
        );
    }

    // -----------------------------------------------------------------------
    // WI-1.4 — Auto-link + emoji through render_markdown
    // -----------------------------------------------------------------------

    #[test]
    fn test_render_autolinks_bare_url() {
        let html = render_markdown("See https://example.com today");
        assert!(
            html.contains("href=\"https://example.com\""),
            "bare URL must become a link, got: {html}"
        );
    }

    #[test]
    fn test_render_does_not_autolink_url_in_code_fence() {
        let html = render_markdown("```\nhttps://example.com\n```");
        assert!(
            !html.contains("href=\"https://example.com\""),
            "URL in code fence must stay literal, got: {html}"
        );
        assert!(
            html.contains("https://example.com"),
            "literal URL kept, got: {html}"
        );
    }

    #[test]
    fn test_render_emoji_shortcode_to_glyph() {
        let html = render_markdown("Ship it :rocket:");
        assert!(
            html.contains("🚀"),
            "shortcode must render glyph, got: {html}"
        );
        assert!(
            !html.contains(":rocket:"),
            "shortcode literal must be gone, got: {html}"
        );
    }

    #[test]
    fn test_render_unknown_emoji_stays_literal() {
        let html = render_markdown("Token :notanemoji: stays");
        assert!(
            html.contains(":notanemoji:"),
            "unknown shortcode must stay literal, got: {html}"
        );
    }

    #[test]
    fn test_sanitize_end_to_end_math_payload_via_render() {
        // Defence in depth: even when raw inline HTML carrying a math-shaped
        // payload is rendered, sanitize_html neutralizes the script.
        let md = "Inline <span class=\"katex\"><math><script>alert(1)</script></math></span> done";
        let html = render_markdown(md);
        let safe = sanitize_html(&html);
        assert!(
            !safe.contains("<script"),
            "script must not survive end-to-end, got: {safe}"
        );
    }
}
