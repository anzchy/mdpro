# Data Model: Window Sessions & WYSIWYG Tables

**Feature**: 003-redesign-plugin-system
**Date**: 2026-01-23

## Entities

### WindowSession

Represents a single app window with its own editor state and active document.

| Field | Type | Description |
|-------|------|-------------|
| `windowId` | `string` | Unique identifier for the window (Tauri label) |
| `activeDocumentId` | `string | null` | Currently active document ID |
| `viewMode` | `ViewMode` | Current view mode (split/editor/preview/wysiwyg) |
| `sidebarOpen` | `boolean` | Sidebar visibility for this window |
| `lastOpenedPaths` | `string[]` | Recent files for this window (optional) |

### DocumentSession

A document instance loaded within a window.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Document ID (UUID) |
| `path` | `string | null` | File path if saved to disk |
| `title` | `string` | Display name |
| `content` | `string` | Current markdown content |
| `isModified` | `boolean` | Unsaved changes |
| `encoding` | `string | null` | File encoding (if known) |

### WindowManager

Frontend service that creates and routes windows.

| Field | Type | Description |
|-------|------|-------------|
| `openWindow` | `(options) => Promise<void>` | Opens a new window with optional file path |
| `getWindowLabel` | `() => string` | Returns current window label |
| `broadcast` | `(event, payload) => void` | Emits events to specific windows |

### TableRenderer

WYSIWYG plugin configuration enabling Markdown tables.

| Field | Type | Description |
|-------|------|-------------|
| `preset` | `"gfm" | "table"` | Milkdown preset used for table support |
| `enabled` | `boolean` | Whether table rendering is active |

## Relationships

```
┌─────────────────┐
│ WindowManager   │
│                 │
│ openWindow ─────┼──► Creates WindowSession
└─────────────────┘
         │
         ▼
┌─────────────────┐
│ WindowSession   │
│                 │
│ activeDocument ─┼──► DocumentSession
│ viewMode        │
│ sidebarOpen     │
└─────────────────┘
```

## State Transitions

### Window Lifecycle

```
create window -> initialize session -> open document -> edit/save -> close window
```

### Document Lifecycle

```
create/open -> edit -> save -> close
```

## Validation Rules

1. **Window IDs**: Must match Tauri window labels and be unique per window.
2. **Document Ownership**: Each DocumentSession belongs to exactly one WindowSession.
3. **Table Rendering**: Only enabled in WYSIWYG mode; source mode unaffected.
