use pulldown_cmark::{html, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use std::collections::HashMap;

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

pub fn render_markdown(markdown: &str) -> String {
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
    let mut heading_text = String::new();

    for event in parser {
        match &event {
            Event::Start(Tag::Heading { level, .. }) => {
                in_heading = true;
                heading_level = Some(*level);
                heading_text.clear();
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
                        level_num, id, id, heading_text, level_num
                    ));
                }
                in_heading = false;
                heading_level = None;
            }
            Event::Text(text) | Event::Code(text) => {
                if in_heading {
                    heading_text.push_str(text);
                } else {
                    html::push_html(&mut html_output, std::iter::once(event.clone()));
                }
            }
            _ => {
                if !in_heading {
                    html::push_html(&mut html_output, std::iter::once(event.clone()));
                }
            }
        }
    }

    html_output
}
