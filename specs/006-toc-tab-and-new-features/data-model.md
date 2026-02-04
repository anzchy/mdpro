# Data Model: TOC, Tabs, Auto-Save, Tables, and Images

**Feature Branch**: `006-toc-tab-and-new-features`
**Date**: 2026-02-03
**Source**: Extracted from [spec.md](./spec.md) Key Entities section

## Entity Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Application State                          │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐    │
│  │   TabStore   │───│DocumentStore │───│   PreferencesStore   │    │
│  └──────────────┘   └──────────────┘   └──────────────────────┘    │
│         │                  │                      │                 │
│         ▼                  ▼                      ▼                 │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐    │
│  │     Tab      │   │   Document   │   │   AutoSaveConfig     │    │
│  │  (has many)  │   │  (has many)  │   │   ImageConfig        │    │
│  └──────────────┘   └──────────────┘   │   TabBarConfig       │    │
│         │                  │           └──────────────────────┘    │
│         │                  ▼                                        │
│         │           ┌──────────────┐                               │
│         │           │   TOCEntry   │                               │
│         │           │  (has many)  │                               │
│         │           └──────────────┘                               │
│         │                                                          │
│         └────────────────────────────────────────────────────────► │
│                      TabState (scroll, cursor)                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Tab

Represents an open document in the tab bar.

### TypeScript Interface

```typescript
// src/stores/tabStore.ts

interface Tab {
  /** Unique identifier for this tab instance */
  id: string;

  /** Reference to the document this tab displays */
  documentId: string;

  /** Display title (filename or "Untitled") */
  title: string;

  /** Whether the tab has unsaved changes */
  isDirty: boolean;

  /** Whether the tab is pinned (cannot be auto-closed) */
  isPinned: boolean;

  /** Order index in the tab bar (0 = leftmost) */
  order: number;

  /** Preserved state for context restoration */
  state: TabState;

  /** Timestamp of last activation (for MRU sorting) */
  lastActiveAt: number;
}

interface TabState {
  /** Scroll position (pixels from top) */
  scrollTop: number;

  /** Cursor position in document */
  cursorPosition: {
    line: number;
    column: number;
  };

  /** View mode when tab was last active */
  viewMode: 'split' | 'editor' | 'preview' | 'wysiwyg';
}

interface ClosedTab {
  /** Original tab data for restoration */
  tab: Tab;

  /** Document content at time of close (for unsaved recovery) */
  content?: string;

  /** Timestamp when closed */
  closedAt: number;
}
```

### Validation Rules

| Field | Rule |
|-------|------|
| `id` | UUID v4 format, unique across all tabs |
| `documentId` | Must reference existing document or be null for new docs |
| `title` | Non-empty string, max 255 characters |
| `order` | Non-negative integer, unique within tab list |
| `state.scrollTop` | Non-negative number |
| `lastActiveAt` | Valid Unix timestamp in milliseconds |

### State Transitions

```
NEW → ACTIVE → DIRTY → SAVED → ACTIVE
                 │
                 └─→ CLOSING → (prompt save?) → CLOSED
                                                   │
                                                   └─→ (undo) → RESTORED
```

---

## 2. TOCEntry

Represents a heading in the Table of Contents.

### TypeScript Interface

```typescript
// src/stores/tocStore.ts

interface TOCEntry {
  /** Unique identifier (generated anchor ID) */
  id: string;

  /** Heading level (1-6 for H1-H6) */
  level: 1 | 2 | 3 | 4 | 5 | 6;

  /** Heading text content */
  text: string;

  /** Line number in document (1-indexed) */
  lineNumber: number;

  /** Character offset from document start */
  offset: number;

  /** Whether this entry is currently in viewport (spy scrolling) */
  isActive: boolean;

  /** Child entries (for hierarchical display) */
  children: TOCEntry[];
}

interface TOCState {
  /** All TOC entries for current document */
  entries: TOCEntry[];

  /** Currently active (highlighted) entry ID */
  activeEntryId: string | null;

  /** Whether TOC view is visible in sidebar */
  isVisible: boolean;

  /** Collapsed entry IDs (for collapsible sections) */
  collapsedIds: Set<string>;
}
```

### Validation Rules

| Field | Rule |
|-------|------|
| `id` | Lowercase, hyphens for spaces, unique (suffix for duplicates) |
| `level` | Integer 1-6 inclusive |
| `text` | Non-empty string (heading content) |
| `lineNumber` | Positive integer |
| `offset` | Non-negative integer |

### Anchor ID Generation

```typescript
function generateAnchorId(text: string, existingIds: Set<string>): string {
  // Base ID: lowercase, replace spaces with hyphens, remove special chars
  let baseId = text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '');

  // Handle duplicates with numeric suffix
  let id = baseId;
  let counter = 1;
  while (existingIds.has(id)) {
    id = `${baseId}-${counter}`;
    counter++;
  }

  return id;
}
```

---

## 3. AutoSaveConfig

Stores user's auto-save preferences.

### TypeScript Interface

```typescript
// src/models/preferences.ts

interface AutoSaveConfig {
  /** Whether auto-save is enabled */
  enabled: boolean;

  /** Auto-save interval in milliseconds (5000, 15000, 60000) */
  intervalMs: 5000 | 15000 | 60000;

  /** Debounce delay before saving after typing stops */
  debounceMs: number;

  /** Whether to save on window blur */
  saveOnBlur: boolean;
}

// Default values
const DEFAULT_AUTO_SAVE_CONFIG: AutoSaveConfig = {
  enabled: true,
  intervalMs: 15000,
  debounceMs: 1500,
  saveOnBlur: true,
};
```

### Rust Struct (Backend)

```rust
// src-tauri/src/models/preferences.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoSaveConfig {
    pub enabled: bool,
    pub interval_ms: u32,
    pub debounce_ms: u32,
    pub save_on_blur: bool,
}

impl Default for AutoSaveConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_ms: 15000,
            debounce_ms: 1500,
            save_on_blur: true,
        }
    }
}
```

### Validation Rules

| Field | Rule |
|-------|------|
| `intervalMs` | Must be one of: 5000, 15000, 60000 |
| `debounceMs` | Range: 500-5000ms |
| `saveOnBlur` | Boolean |

---

## 4. TableCell

Represents a cell in a rendered table.

### TypeScript Interface

```typescript
// src/plugins/milkdown/tablePlugin.ts

interface TableCell {
  /** Row index (0-indexed) */
  row: number;

  /** Column index (0-indexed) */
  column: number;

  /** Cell content (Markdown text) */
  content: string;

  /** Whether this is a header cell */
  isHeader: boolean;

  /** Column alignment */
  alignment: 'left' | 'center' | 'right' | null;
}

interface TableState {
  /** All cells in the table */
  cells: TableCell[][];

  /** Number of rows */
  rowCount: number;

  /** Number of columns */
  columnCount: number;

  /** Currently selected cell (for context menu) */
  selectedCell: { row: number; column: number } | null;

  /** Column widths (for resize) */
  columnWidths: number[];
}

interface TableContextMenuAction {
  type:
    | 'insertRowAbove'
    | 'insertRowBelow'
    | 'insertColumnLeft'
    | 'insertColumnRight'
    | 'deleteRow'
    | 'deleteColumn'
    | 'alignLeft'
    | 'alignCenter'
    | 'alignRight';

  /** Target row/column for the action */
  target: { row?: number; column?: number };
}
```

### Validation Rules

| Field | Rule |
|-------|------|
| `row` | Non-negative integer, < rowCount |
| `column` | Non-negative integer, < columnCount |
| `alignment` | One of: 'left', 'center', 'right', null |
| `columnWidths` | Array of positive numbers (pixels) |

---

## 5. ImageReference

Represents an image in the document.

### TypeScript Interface

```typescript
// src/services/imageService.ts

interface ImageReference {
  /** Original path from Markdown syntax */
  originalPath: string;

  /** Resolved absolute path (for local images) */
  resolvedPath: string | null;

  /** Image alt text */
  altText: string;

  /** Image title (optional) */
  title?: string;

  /** Whether this is a remote URL */
  isRemote: boolean;

  /** Loading state */
  loadState: 'loading' | 'loaded' | 'error';

  /** Error message if load failed */
  errorMessage?: string;

  /** Image dimensions (if known) */
  dimensions?: {
    width: number;
    height: number;
  };
}

interface ImageConfig {
  /** Default folder for uploaded/pasted images */
  assetFolder: string;

  /** Whether to copy external images to asset folder */
  copyExternalImages: boolean;

  /** Whether to show preview before inserting pasted images */
  showPastePreview: boolean;

  /** Maximum image dimension (for auto-resize) */
  maxDimension?: number;
}

// Default values
const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  assetFolder: './assets',
  copyExternalImages: true,
  showPastePreview: true,
  maxDimension: undefined, // No limit
};
```

### Rust Struct (Backend)

```rust
// src-tauri/src/models/image.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageReference {
    pub original_path: String,
    pub resolved_path: Option<String>,
    pub alt_text: String,
    pub title: Option<String>,
    pub is_remote: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageConfig {
    pub asset_folder: String,
    pub copy_external_images: bool,
    pub show_paste_preview: bool,
    pub max_dimension: Option<u32>,
}

impl Default for ImageConfig {
    fn default() -> Self {
        Self {
            asset_folder: "./assets".to_string(),
            copy_external_images: true,
            show_paste_preview: true,
            max_dimension: None,
        }
    }
}
```

### Validation Rules

| Field | Rule |
|-------|------|
| `originalPath` | Non-empty string |
| `assetFolder` | Valid relative or absolute path |
| `maxDimension` | Positive integer if set |

---

## 6. TabBarConfig

Configuration for tab bar appearance and behavior.

### TypeScript Interface

```typescript
// src/models/preferences.ts

interface TabBarConfig {
  /** Position of tab bar */
  position: 'top' | 'bottom';

  /** Maximum number of visible tabs before scrolling */
  maxVisibleTabs: number;

  /** Whether to show close button on hover only */
  showCloseOnHover: boolean;

  /** Focus behavior when closing active tab */
  closeFocusBehavior: 'mru' | 'right' | 'left';
}

// Default values
const DEFAULT_TAB_BAR_CONFIG: TabBarConfig = {
  position: 'top',
  maxVisibleTabs: 10,
  showCloseOnHover: true,
  closeFocusBehavior: 'mru',
};
```

---

## Store Relationships

### Document Store Extensions

```typescript
// src/stores/documentStore.ts (MODIFIED)

interface DocumentState {
  // Existing fields...
  documents: Map<string, Document>;
  activeDocumentId: string | null;

  // NEW: Support for multi-document
  getDocumentById(id: string): Document | undefined;
  setActiveDocument(id: string): void;
}
```

### Tab Store

```typescript
// src/stores/tabStore.ts (NEW)

interface TabStoreState {
  tabs: Tab[];
  activeTabId: string | null;
  closedTabs: ClosedTab[]; // Max 10, LIFO

  // Actions
  openTab(documentId: string, title: string): string; // Returns tab ID
  closeTab(tabId: string): void;
  switchToTab(tabId: string): void;
  setTabDirty(tabId: string, isDirty: boolean): void;
  reorderTabs(fromIndex: number, toIndex: number): void;
  pinTab(tabId: string): void;
  unpinTab(tabId: string): void;
  undoCloseTab(): Tab | null;
  saveTabState(tabId: string, state: Partial<TabState>): void;
}
```

### TOC Store

```typescript
// src/stores/tocStore.ts (NEW)

interface TOCStoreState {
  entries: TOCEntry[];
  activeEntryId: string | null;
  isVisible: boolean;
  collapsedIds: Set<string>;

  // Actions
  setEntries(entries: TOCEntry[]): void;
  setActiveEntry(id: string | null): void;
  toggleVisibility(): void;
  toggleCollapsed(id: string): void;
  navigateToEntry(id: string): void;
}
```

---

## Database Schema (Preferences JSON)

```json
{
  "version": "0.2.0",
  "autoSave": {
    "enabled": true,
    "intervalMs": 15000,
    "debounceMs": 1500,
    "saveOnBlur": true
  },
  "tabBar": {
    "position": "top",
    "maxVisibleTabs": 10,
    "showCloseOnHover": true,
    "closeFocusBehavior": "mru"
  },
  "image": {
    "assetFolder": "./assets",
    "copyExternalImages": true,
    "showPastePreview": true,
    "maxDimension": null
  },
  "recentTabs": [
    {
      "documentPath": "/path/to/doc.md",
      "state": {
        "scrollTop": 0,
        "cursorPosition": { "line": 1, "column": 0 },
        "viewMode": "wysiwyg"
      }
    }
  ]
}
```
