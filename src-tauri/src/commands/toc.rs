use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadingInfo {
    /// Generated anchor ID (unique within document)
    pub id: String,
    /// Heading level (1-6)
    pub level: usize,
    /// Heading text content (stripped of formatting)
    pub text: String,
    /// Line number (1-indexed)
    pub line: usize,
    /// Character offset from document start
    pub offset: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetDocumentHeadingsResult {
    pub headings: Vec<HeadingInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum TocError {
    DocumentNotFound { document_id: String },
    ParseError { message: String },
}

/// Generate a unique ID from heading text, handling duplicates
fn generate_unique_id(text: &str, counts: &mut HashMap<String, usize>) -> String {
    // Base ID: lowercase, replace non-alphanumeric with hyphens
    let base_id: String = text
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    // Handle empty base ID
    let base_id = if base_id.is_empty() {
        "heading".to_string()
    } else {
        base_id
    };

    let count = counts.entry(base_id.clone()).or_insert(0);
    let id = if *count == 0 {
        base_id.clone()
    } else {
        format!("{}-{}", base_id, count)
    };
    *count += 1;
    id
}

/// Convert HeadingLevel to numeric level
fn heading_level_to_usize(level: HeadingLevel) -> usize {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

/// Extract headings from Markdown content
pub fn extract_headings(content: &str) -> Vec<HeadingInfo> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);
    options.insert(Options::ENABLE_TABLES);

    let parser = Parser::new_ext(content, options);
    let mut headings = Vec::new();
    let mut id_counts: HashMap<String, usize> = HashMap::new();
    let mut current_heading: Option<(usize, String, usize)> = None; // (level, text, start_offset)

    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                current_heading = Some((heading_level_to_usize(level), String::new(), range.start));
            }
            Event::Text(text) if current_heading.is_some() => {
                if let Some((_, ref mut content, _)) = current_heading {
                    content.push_str(&text);
                }
            }
            Event::Code(code) if current_heading.is_some() => {
                // Include inline code in heading text
                if let Some((_, ref mut content, _)) = current_heading {
                    content.push_str(&code);
                }
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some((level, text, start_offset)) = current_heading.take() {
                    let id = generate_unique_id(&text, &mut id_counts);
                    // Calculate line number from offset
                    let line = content[..start_offset].matches('\n').count() + 1;

                    headings.push(HeadingInfo {
                        id,
                        level,
                        text,
                        line,
                        offset: start_offset,
                    });
                }
            }
            _ => {}
        }
    }

    headings
}

/// Get all headings from a document's content
#[tauri::command]
pub async fn get_document_headings(
    content: String,
) -> Result<GetDocumentHeadingsResult, TocError> {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "toc.extract".to_string(),
        status: LogStatus::Start,
        action_id: None,
        context: Some(serde_json::json!({
            "content_length": content.len()
        })),
        duration_ms: None,
        error: None,
    });

    let start = std::time::Instant::now();
    let headings = extract_headings(&content);
    let duration = start.elapsed().as_millis() as u64;

    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "toc.extract".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(serde_json::json!({
            "heading_count": headings.len()
        })),
        duration_ms: Some(duration),
        error: None,
    });

    Ok(GetDocumentHeadingsResult { headings })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_headings() {
        let content = r#"
# Heading 1

Some text.

## Heading 2

### Heading 3

## Another Heading 2

# Duplicate
# Duplicate
"#;

        let headings = extract_headings(content);

        assert_eq!(headings.len(), 6);
        assert_eq!(headings[0].level, 1);
        assert_eq!(headings[0].text, "Heading 1");
        assert_eq!(headings[0].id, "heading-1");

        assert_eq!(headings[1].level, 2);
        assert_eq!(headings[1].text, "Heading 2");
        assert_eq!(headings[1].id, "heading-2");

        assert_eq!(headings[2].level, 3);
        assert_eq!(headings[2].text, "Heading 3");
        assert_eq!(headings[2].id, "heading-3");

        // Check duplicate handling
        assert_eq!(headings[4].text, "Duplicate");
        assert_eq!(headings[4].id, "duplicate");
        assert_eq!(headings[5].text, "Duplicate");
        assert_eq!(headings[5].id, "duplicate-1");
    }

    #[test]
    fn test_generate_unique_id() {
        let mut counts = HashMap::new();

        assert_eq!(generate_unique_id("Hello World", &mut counts), "hello-world");
        assert_eq!(
            generate_unique_id("Hello World", &mut counts),
            "hello-world-1"
        );
        assert_eq!(generate_unique_id("Test", &mut counts), "test");
        assert_eq!(
            generate_unique_id("Hello World", &mut counts),
            "hello-world-2"
        );
    }

    #[test]
    fn test_empty_content() {
        let headings = extract_headings("");
        assert!(headings.is_empty());
    }

    #[test]
    fn test_no_headings() {
        let content = "Just some text\n\nWith paragraphs\n";
        let headings = extract_headings(content);
        assert!(headings.is_empty());
    }
}
