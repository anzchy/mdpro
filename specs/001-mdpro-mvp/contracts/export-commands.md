# Export Commands Contract

**Module**: `src-tauri/src/commands/export.rs`
**Frontend Service**: `src/services/exportService.ts`

## Overview

Tauri IPC commands for exporting documents to HTML format.

---

## Commands

### `export_html`

Exports document content to HTML file with inline styles.

**Request**:
```typescript
invoke('export_html', {
  content: string,
  title: string,
  theme: 'light' | 'dark'
})
```

**Response**:
```typescript
interface ExportResult {
  success: boolean;
  path: string;
  htmlSize: number;  // Bytes
}
```

**Errors**:
| Code | Message | When |
|------|---------|------|
| `PERMISSION_DENIED` | Cannot write file | No write permission |
| `DISK_FULL` | Insufficient disk space | No space left |
| `EXPORT_FAILED` | Export generation failed | Markdown parse error |

**Notes**:
- Opens native save dialog for destination
- Generates self-contained HTML with embedded CSS
- Theme determines color scheme in exported HTML

**Rust Signature**:
```rust
#[tauri::command]
async fn export_html(
    window: Window,
    content: String,
    title: String,
    theme: String
) -> Result<ExportResult, ExportError>;
```

---

### `preview_html`

Generates HTML preview string without saving.

**Request**:
```typescript
invoke('preview_html', {
  content: string,
  theme: 'light' | 'dark'
})
```

**Response**:
```typescript
string  // Full HTML document string
```

**Notes**:
- Used for copy-to-clipboard functionality
- Returns complete HTML with doctype, head, body

**Rust Signature**:
```rust
#[tauri::command]
fn preview_html(content: String, theme: String) -> String;
```

---

### `render_markdown`

Renders markdown to HTML fragment (for live preview).

**Request**:
```typescript
invoke('render_markdown', { content: string })
```

**Response**:
```typescript
string  // HTML fragment (no doctype/head/body)
```

**Notes**:
- Used for real-time preview pane
- Returns sanitized HTML fragment
- Supports GFM extensions (tables, task lists, strikethrough)
- Supports mark and underline tags

**Rust Signature**:
```rust
#[tauri::command]
fn render_markdown(content: String) -> String;
```

---

## Error Types

```rust
// src-tauri/src/commands/export.rs

#[derive(Debug, Serialize, Deserialize)]
pub enum ExportError {
    PermissionDenied { path: String },
    DiskFull,
    ExportFailed { message: String },
    Cancelled,
}
```

---

## HTML Template

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{title}}</title>
  <style>
    /* Inline CSS based on theme */
    {{styles}}
  </style>
</head>
<body class="{{theme}}">
  <article class="markdown-body">
    {{content}}
  </article>
</body>
</html>
```

---

## Frontend Service

```typescript
// src/services/exportService.ts

import { invoke } from '@tauri-apps/api/core';

export const exportService = {
  async exportHtml(
    content: string,
    title: string,
    theme: 'light' | 'dark'
  ): Promise<ExportResult> {
    return invoke('export_html', { content, title, theme });
  },

  async previewHtml(content: string, theme: 'light' | 'dark'): Promise<string> {
    return invoke('preview_html', { content, theme });
  },

  async renderMarkdown(content: string): Promise<string> {
    return invoke('render_markdown', { content });
  },
};
```
