# IPC Command Contracts

**Feature**: 004-minor-fix
**Date**: 2026-01-25

## Overview

This document defines the IPC command contracts between the React frontend and Rust backend for the multi-window feature.

## New Commands

### `create_window`

Creates a new mdpro window, optionally with a file to open.

**Direction**: Frontend → Backend

**Request**:
```typescript
interface CreateWindowRequest {
  filePath?: string;  // Optional file path to open in new window
}
```

**Response**:
```typescript
interface CreateWindowResponse {
  windowId: string;  // Unique identifier for the new window (e.g., "mdpro-uuid")
}
```

**Errors**:
| Code | Message | Cause |
|------|---------|-------|
| `WINDOW_CREATE_FAILED` | Failed to create window | Tauri window builder error |
| `FILE_NOT_FOUND` | File does not exist | Specified file path invalid |

**Example**:
```typescript
// Create empty window
const { windowId } = await invoke<CreateWindowResponse>('create_window', {});

// Create window with file
const { windowId } = await invoke<CreateWindowResponse>('create_window', {
  filePath: '/Users/jack/notes.md'
});
```

---

### `save_window_geometry`

Persists window position and size for a specific file path.

**Direction**: Frontend → Backend

**Request**:
```typescript
interface SaveWindowGeometryRequest {
  filePath: string;  // File path as storage key
  geometry: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
```

**Response**:
```typescript
type SaveWindowGeometryResponse = void;  // Success returns nothing
```

**Errors**:
| Code | Message | Cause |
|------|---------|-------|
| `PREFERENCES_SAVE_FAILED` | Failed to save preferences | File I/O error |

**Example**:
```typescript
await invoke('save_window_geometry', {
  filePath: '/Users/jack/notes.md',
  geometry: { x: 100, y: 100, width: 1200, height: 800 }
});
```

---

### `get_window_geometry`

Retrieves stored window geometry for a file path.

**Direction**: Frontend → Backend

**Request**:
```typescript
interface GetWindowGeometryRequest {
  filePath: string;
}
```

**Response**:
```typescript
interface GetWindowGeometryResponse {
  geometry: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;  // null if no stored state
}
```

**Example**:
```typescript
const { geometry } = await invoke<GetWindowGeometryResponse>('get_window_geometry', {
  filePath: '/Users/jack/notes.md'
});

if (geometry) {
  // Apply stored position/size
}
```

---

## Modified Commands

### `set_preferences` (Extended)

Add support for `defaultViewMode` field updates.

**Request** (addition):
```typescript
interface PartialPreferences {
  // ... existing fields
  defaultViewMode?: 'split' | 'editor-only' | 'preview-only' | 'wysiwyg';
}
```

**Example**:
```typescript
await invoke('set_preferences', {
  preferences: {
    defaultViewMode: 'wysiwyg'
  }
});
```

---

## Events

### `menu:action` (Existing)

Menu events already defined. Relevant actions for this feature:

| Action | Value | Trigger |
|--------|-------|---------|
| `file.new` | `null` | ⌘N (creates new document in current window) |
| `file.new_window` | `null` | ⌘⇧N (creates new window) |
| `file.save` | `null` | ⌘S (save current document) |

**Handling**:
```typescript
// In useMenuEvents.ts
case 'file.new_window':
  await windowService.createWindow();
  break;
```

---

### `file:open` (Modified Behavior)

When emitted from backend to frontend, behavior changes based on window state:

**Current Behavior**:
- Opens file(s) in the current/main window

**New Behavior**:
- If current window has untitled empty document: open file in current window
- If current window has a document: backend creates new window and emits to that window

**Payload**:
```typescript
type FileOpenPayload = string[];  // Array of file paths
```

---

## Frontend Service Wrapper

```typescript
// src/services/windowService.ts

import { invoke } from '@tauri-apps/api/core';

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const windowService = {
  /**
   * Create a new mdpro window
   * @param filePath Optional file to open in the new window
   * @returns Window ID of the created window
   */
  async createWindow(filePath?: string): Promise<string> {
    const response = await invoke<{ windowId: string }>('create_window', {
      filePath: filePath ?? null
    });
    return response.windowId;
  },

  /**
   * Save window geometry for a file
   */
  async saveWindowGeometry(filePath: string, geometry: WindowGeometry): Promise<void> {
    await invoke('save_window_geometry', { filePath, geometry });
  },

  /**
   * Get stored window geometry for a file
   * @returns Geometry or null if not stored
   */
  async getWindowGeometry(filePath: string): Promise<WindowGeometry | null> {
    const response = await invoke<{ geometry: WindowGeometry | null }>('get_window_geometry', {
      filePath
    });
    return response.geometry;
  }
};
```

## Rust Command Signatures

```rust
// src-tauri/src/commands/window.rs

#[tauri::command]
pub async fn create_window(
    app: AppHandle,
    file_path: Option<String>
) -> Result<CreateWindowResponse, String>;

#[tauri::command]
pub async fn save_window_geometry(
    file_path: String,
    geometry: WindowGeometry
) -> Result<(), PreferencesError>;

#[tauri::command]
pub async fn get_window_geometry(
    file_path: String
) -> Result<GetWindowGeometryResponse, PreferencesError>;
```

## Registration

```rust
// src-tauri/src/commands/mod.rs

pub mod window;  // Add this line

pub fn handlers() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool {
    tauri::generate_handler![
        // ... existing handlers
        window::create_window,
        window::save_window_geometry,
        window::get_window_geometry,
    ]
}
```
