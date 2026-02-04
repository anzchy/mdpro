# IPC Contracts: TOC Commands

**Feature**: TOC Sidebar (FR-001 to FR-004)
**Module**: `src-tauri/src/commands/toc.rs`

## Commands

### `get_document_headings`

Extracts all headings from a document's Markdown content.

**Direction**: Frontend → Backend

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `document_id` | `string` | Yes | ID of the document to parse |

**Returns**:

```typescript
interface GetDocumentHeadingsResult {
  headings: HeadingInfo[];
}

interface HeadingInfo {
  /** Generated anchor ID (unique within document) */
  id: string;
  /** Heading level (1-6) */
  level: number;
  /** Heading text content (stripped of formatting) */
  text: string;
  /** Line number (1-indexed) */
  line: number;
  /** Character offset from document start */
  offset: number;
}
```

**Errors**:

| Code | Description |
|------|-------------|
| `DOCUMENT_NOT_FOUND` | No document with given ID |
| `PARSE_ERROR` | Failed to parse Markdown |

**Rust Signature**:

```rust
#[tauri::command]
pub async fn get_document_headings(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<GetDocumentHeadingsResult, CommandError>
```

**Usage Example**:

```typescript
// src/services/tocService.ts
import { invoke } from '@tauri-apps/api/core';

export async function getDocumentHeadings(documentId: string): Promise<HeadingInfo[]> {
  const result = await invoke<GetDocumentHeadingsResult>('get_document_headings', {
    document_id: documentId,
  });
  return result.headings;
}
```

---

### `scroll_to_heading`

Scrolls the editor to a specific heading position.

**Direction**: Frontend → Backend (optional, can be frontend-only)

**Note**: This command may be implemented purely in frontend using DOM manipulation. Listed here for completeness if backend coordination is needed.

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `document_id` | `string` | Yes | ID of the document |
| `heading_id` | `string` | Yes | Anchor ID of the heading |
| `smooth` | `boolean` | No | Use smooth scrolling (default: true) |

**Returns**:

```typescript
interface ScrollToHeadingResult {
  success: boolean;
  /** Actual scroll position achieved */
  scrollTop: number;
}
```

---

## Events

### `toc:updated`

Emitted when the document's heading structure changes.

**Direction**: Backend → Frontend

**Payload**:

```typescript
interface TocUpdatedEvent {
  documentId: string;
  headings: HeadingInfo[];
}
```

**Trigger Conditions**:
- Document content changes (debounced)
- Document is opened
- Document is reloaded from disk

---

## Implementation Notes

### Heading Extraction (Rust)

Use `pulldown-cmark` parser with `ENABLE_HEADING_ATTRIBUTES` option:

```rust
use pulldown_cmark::{Parser, Event, Tag, Options};

pub fn extract_headings(content: &str) -> Vec<HeadingInfo> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);

    let parser = Parser::new_ext(content, options);
    let mut headings = Vec::new();
    let mut current_heading: Option<(usize, String)> = None;
    let mut id_counts: HashMap<String, usize> = HashMap::new();
    let mut offset = 0;

    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(Tag::Heading(level, ..)) => {
                current_heading = Some((level as usize, String::new()));
            }
            Event::Text(text) if current_heading.is_some() => {
                if let Some((_, ref mut content)) = current_heading {
                    content.push_str(&text);
                }
            }
            Event::End(Tag::Heading(level, ..)) => {
                if let Some((lvl, text)) = current_heading.take() {
                    let id = generate_unique_id(&text, &mut id_counts);
                    let line = content[..range.start].matches('\n').count() + 1;
                    headings.push(HeadingInfo {
                        id,
                        level: lvl,
                        text,
                        line,
                        offset: range.start,
                    });
                }
            }
            _ => {}
        }
    }

    headings
}
```

### Duplicate ID Handling

```rust
fn generate_unique_id(text: &str, counts: &mut HashMap<String, usize>) -> String {
    let base_id = text
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    let count = counts.entry(base_id.clone()).or_insert(0);
    let id = if *count == 0 {
        base_id.clone()
    } else {
        format!("{}-{}", base_id, count)
    };
    *count += 1;
    id
}
```
