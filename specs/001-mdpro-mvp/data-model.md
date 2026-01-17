# Data Model: mdpro MVP

**Branch**: `001-mdpro-mvp` | **Date**: 2026-01-17 | **Spec**: [spec.md](./spec.md)

## Overview

This document defines the data structures for mdpro MVP, covering both Rust backend models and TypeScript frontend types.

---

## 1. Document

Represents a Markdown document being edited.

### Rust (Backend)

```rust
// src-tauri/src/models/document.rs

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    /// Unique identifier (hash of original path or UUID for new docs)
    pub id: String,

    /// File path on disk (None for unsaved new documents)
    pub path: Option<PathBuf>,

    /// Raw markdown content
    pub content: String,

    /// File encoding (default: UTF-8)
    pub encoding: String,

    /// Whether document has unsaved changes
    pub is_modified: bool,

    /// Last saved timestamp (Unix epoch milliseconds)
    pub last_saved: Option<i64>,

    /// File size in bytes (for large file warnings)
    pub file_size: Option<u64>,
}

impl Document {
    pub fn new() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            path: None,
            content: String::new(),
            encoding: "UTF-8".to_string(),
            is_modified: false,
            last_saved: None,
            file_size: None,
        }
    }

    pub fn from_path(path: PathBuf, content: String) -> Self {
        let id = Self::generate_id(&path);
        let file_size = std::fs::metadata(&path).ok().map(|m| m.len());

        Self {
            id,
            path: Some(path),
            content,
            encoding: "UTF-8".to_string(),
            is_modified: false,
            last_saved: Some(chrono::Utc::now().timestamp_millis()),
            file_size,
        }
    }

    fn generate_id(path: &PathBuf) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        path.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }
}
```

### TypeScript (Frontend)

```typescript
// src/types/document.ts

export interface Document {
  /** Unique identifier */
  id: string;

  /** File path on disk (null for unsaved) */
  path: string | null;

  /** Raw markdown content */
  content: string;

  /** File encoding */
  encoding: string;

  /** Has unsaved changes */
  isModified: boolean;

  /** Last saved timestamp (Unix epoch ms) */
  lastSaved: number | null;

  /** File size in bytes */
  fileSize: number | null;
}

export interface DocumentMetadata {
  id: string;
  path: string | null;
  title: string;  // Derived from first heading or filename
  isModified: boolean;
}
```

### Validation Rules

| Field | Rule |
|-------|------|
| `id` | Non-empty string, unique per session |
| `path` | Valid filesystem path or null |
| `content` | Any string (empty allowed) |
| `encoding` | Supported: UTF-8, UTF-16, ASCII |
| `file_size` | Warning if > 10MB (from Edge Cases) |

---

## 2. EditorState

Represents the current state of the editor UI.

### TypeScript (Frontend - Primary)

```typescript
// src/types/editor.ts

export type ViewMode = 'split' | 'editor-only' | 'preview-only' | 'wysiwyg';

export interface CursorPosition {
  /** Line number (0-indexed) */
  line: number;

  /** Column/character position (0-indexed) */
  column: number;
}

export interface SelectionRange {
  /** Start position */
  anchor: CursorPosition;

  /** End position (same as anchor if no selection) */
  head: CursorPosition;
}

export interface ScrollPosition {
  /** Scroll offset from top (pixels) */
  top: number;

  /** First visible line number */
  firstVisibleLine: number;
}

export interface EditorState {
  /** Currently active document ID */
  activeDocumentId: string | null;

  /** Current view mode */
  viewMode: ViewMode;

  /** Cursor position in editor */
  cursor: CursorPosition;

  /** Current text selection */
  selection: SelectionRange | null;

  /** Editor scroll position */
  editorScroll: ScrollPosition;

  /** Preview scroll position (for sync) */
  previewScroll: ScrollPosition;

  /** Is editor focused */
  isFocused: boolean;

  /** Undo stack depth (for UI indicators) */
  undoDepth: number;

  /** Redo stack depth */
  redoDepth: number;
}
```

### State Transitions

```
┌─────────────┐    toggleView()    ┌──────────────┐
│    split    │ ◄────────────────► │ editor-only  │
└─────────────┘                    └──────────────┘
       ▲                                  ▲
       │ toggleView()          toggleView()│
       ▼                                  ▼
┌─────────────┐    toggleView()    ┌──────────────┐
│   wysiwyg   │ ◄────────────────► │ preview-only │
└─────────────┘                    └──────────────┘
```

---

## 3. Theme

Represents theme configuration for the application.

### TypeScript (Frontend)

```typescript
// src/types/theme.ts

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeColors {
  /** Editor background */
  editorBg: string;

  /** Editor text color */
  editorText: string;

  /** Preview background */
  previewBg: string;

  /** Preview text color */
  previewText: string;

  /** Sidebar background */
  sidebarBg: string;

  /** Toolbar background */
  toolbarBg: string;

  /** Accent color (buttons, links) */
  accent: string;

  /** Border color */
  border: string;

  /** Selection highlight */
  selection: string;

  /** Code block background */
  codeBg: string;
}

export interface ThemeFonts {
  /** Editor font family */
  editorFont: string;

  /** Editor font size (px) */
  editorFontSize: number;

  /** Preview font family */
  previewFont: string;

  /** Preview font size (px) */
  previewFontSize: number;

  /** Code font family (monospace) */
  codeFont: string;

  /** Line height multiplier */
  lineHeight: number;
}

export interface Theme {
  /** Theme identifier */
  id: 'light' | 'dark';

  /** Display name */
  name: string;

  /** Color palette */
  colors: ThemeColors;

  /** Font settings */
  fonts: ThemeFonts;
}
```

### Default Themes

```typescript
// Light theme defaults
const lightTheme: Theme = {
  id: 'light',
  name: 'Light',
  colors: {
    editorBg: '#ffffff',
    editorText: '#1a1a1a',
    previewBg: '#fafafa',
    previewText: '#333333',
    sidebarBg: '#f5f5f5',
    toolbarBg: '#ffffff',
    accent: '#0066cc',
    border: '#e0e0e0',
    selection: '#b3d4fc',
    codeBg: '#f4f4f4',
  },
  fonts: {
    editorFont: 'SF Mono, Menlo, monospace',
    editorFontSize: 14,
    previewFont: '-apple-system, BlinkMacSystemFont, sans-serif',
    previewFontSize: 16,
    codeFont: 'SF Mono, Menlo, monospace',
    lineHeight: 1.6,
  },
};

// Dark theme defaults
const darkTheme: Theme = {
  id: 'dark',
  name: 'Dark',
  colors: {
    editorBg: '#1e1e1e',
    editorText: '#d4d4d4',
    previewBg: '#252525',
    previewText: '#cccccc',
    sidebarBg: '#181818',
    toolbarBg: '#1e1e1e',
    accent: '#4fc3f7',
    border: '#3c3c3c',
    selection: '#264f78',
    codeBg: '#2d2d2d',
  },
  fonts: {
    editorFont: 'SF Mono, Menlo, monospace',
    editorFontSize: 14,
    previewFont: '-apple-system, BlinkMacSystemFont, sans-serif',
    previewFontSize: 16,
    codeFont: 'SF Mono, Menlo, monospace',
    lineHeight: 1.6,
  },
};
```

---

## 4. UserPreferences

Represents user preferences stored locally.

### Rust (Backend - Storage)

```rust
// src-tauri/src/models/preferences.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPreferences {
    /// Theme mode preference
    pub theme_mode: ThemeMode,

    /// Auto-save interval in seconds (default: 30)
    pub auto_save_interval: u32,

    /// Default view mode on startup
    pub default_view_mode: ViewMode,

    /// Show sidebar on startup
    pub show_sidebar: bool,

    /// Enable scroll sync between editor and preview
    pub enable_scroll_sync: bool,

    /// Recently opened files (max 10)
    pub recent_files: Vec<String>,

    /// Window dimensions on last close
    pub window_state: WindowState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ThemeMode {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ViewMode {
    Split,
    EditorOnly,
    PreviewOnly,
    Wysiwyg,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_maximized: bool,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            theme_mode: ThemeMode::System,
            auto_save_interval: 30,
            default_view_mode: ViewMode::Split,
            show_sidebar: true,
            enable_scroll_sync: true,
            recent_files: Vec::new(),
            window_state: WindowState {
                width: 1200,
                height: 800,
                x: 100,
                y: 100,
                is_maximized: false,
            },
        }
    }
}
```

### TypeScript (Frontend)

```typescript
// src/types/preferences.ts

export interface UserPreferences {
  /** Theme mode preference */
  themeMode: 'light' | 'dark' | 'system';

  /** Auto-save interval in seconds */
  autoSaveInterval: number;

  /** Default view mode on startup */
  defaultViewMode: ViewMode;

  /** Show sidebar on startup */
  showSidebar: boolean;

  /** Enable scroll sync */
  enableScrollSync: boolean;

  /** Recently opened file paths */
  recentFiles: string[];

  /** Window state */
  windowState: WindowState;
}

export interface WindowState {
  width: number;
  height: number;
  x: number;
  y: number;
  isMaximized: boolean;
}
```

### Storage Location

```
~/.mdpro/
├── config.json          # UserPreferences
├── drafts/              # Auto-saved drafts
│   ├── {hash}.draft.md  # Draft content
│   └── {hash}.meta.json # Draft metadata
└── cache/               # Preview cache (future)
```

---

## 5. Draft (Auto-save)

Represents an auto-saved draft for crash recovery.

### Rust (Backend)

```rust
// src-tauri/src/models/draft.rs

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Draft {
    /// Hash-based identifier
    pub id: String,

    /// Original file path (if saved file)
    pub original_path: Option<PathBuf>,

    /// Draft content
    pub content: String,

    /// Last modification timestamp
    pub last_modified: i64,

    /// Has this draft been recovered?
    pub recovered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftMetadata {
    /// Original file path
    pub original_path: Option<String>,

    /// Last modification timestamp (ISO 8601)
    pub last_modified: String,

    /// Has been recovered
    pub recovered: bool,

    /// Document title (first heading or filename)
    pub title: String,
}
```

### Draft Lifecycle

```
Document Modified
       │
       ▼
  30s Timer Expires
       │
       ▼
┌──────────────────┐
│ Save to ~/.mdpro │
│ /drafts/{id}.md  │
└──────────────────┘
       │
       ▼
  User Saves (Cmd+S)
       │
       ▼
┌──────────────────┐
│  Delete Draft    │
└──────────────────┘
```

---

## 6. IPC Message Types

Shared types for Tauri IPC communication.

### Rust

```rust
// src-tauri/src/models/ipc.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenFileResult {
    pub document: Document,
    pub recovered_draft: Option<Draft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveResult {
    pub success: bool,
    pub path: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub success: bool,
    pub path: String,
    pub html_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangedEvent {
    pub path: String,
    pub change_type: FileChangeType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileChangeType {
    Modified,
    Deleted,
    Renamed { new_path: String },
}
```

---

## Entity Relationships

```
┌─────────────────┐       1:N        ┌─────────────────┐
│ UserPreferences │──────────────────│    Document     │
│                 │  (recent_files)  │                 │
└─────────────────┘                  └─────────────────┘
                                            │
                                            │ 1:1
                                            ▼
                                     ┌─────────────────┐
                                     │     Draft       │
                                     │  (auto-save)    │
                                     └─────────────────┘

┌─────────────────┐       1:1        ┌─────────────────┐
│   EditorState   │──────────────────│    Document     │
│                 │ (activeDocId)    │                 │
└─────────────────┘                  └─────────────────┘

┌─────────────────┐       1:1        ┌─────────────────┐
│      Theme      │──────────────────│ UserPreferences │
│                 │  (themeMode)     │                 │
└─────────────────┘                  └─────────────────┘
```

---

## Summary

| Entity | Backend (Rust) | Frontend (TS) | Storage |
|--------|----------------|---------------|---------|
| Document | `models/document.rs` | `types/document.ts` | Memory + File |
| EditorState | N/A | `types/editor.ts` | Memory |
| Theme | N/A | `types/theme.ts` | Memory |
| UserPreferences | `models/preferences.rs` | `types/preferences.ts` | `~/.mdpro/config.json` |
| Draft | `models/draft.rs` | N/A | `~/.mdpro/drafts/` |
