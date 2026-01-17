# File Commands Contract

**Module**: `src-tauri/src/commands/file.rs`
**Frontend Service**: `src/services/fileService.ts`

## Overview

Tauri IPC commands for file operations (open, save, create).

---

## Commands

### `open_file`

Opens a markdown file from disk.

**Request**:
```typescript
invoke('open_file', { path: string })
```

**Response**:
```typescript
interface OpenFileResult {
  document: Document;
  recoveredDraft: Draft | null;  // If newer draft exists
}
```

**Errors**:
| Code | Message | When |
|------|---------|------|
| `FILE_NOT_FOUND` | File does not exist | Path invalid |
| `PERMISSION_DENIED` | Cannot read file | No read permission |
| `ENCODING_ERROR` | Cannot decode file | Non-UTF8 without fallback |
| `FILE_TOO_LARGE` | File exceeds 10MB limit | Size > 10MB |

**Rust Signature**:
```rust
#[tauri::command]
async fn open_file(path: String) -> Result<OpenFileResult, FileError>;
```

---

### `open_file_dialog`

Opens native file picker dialog.

**Request**:
```typescript
invoke('open_file_dialog', {})
```

**Response**:
```typescript
interface OpenFileResult | null  // null if user cancels
```

**Notes**:
- Filters for `.md` and `.markdown` extensions
- Returns null if dialog cancelled

**Rust Signature**:
```rust
#[tauri::command]
async fn open_file_dialog(window: Window) -> Result<Option<OpenFileResult>, FileError>;
```

---

### `save_file`

Saves document to disk.

**Request**:
```typescript
invoke('save_file', {
  documentId: string,
  content: string,
  path?: string  // Optional: for Save As
})
```

**Response**:
```typescript
interface SaveResult {
  success: boolean;
  path: string;
  savedAt: number;  // Unix timestamp ms
}
```

**Errors**:
| Code | Message | When |
|------|---------|------|
| `PERMISSION_DENIED` | Cannot write file | No write permission |
| `DISK_FULL` | Insufficient disk space | No space left |
| `INVALID_PATH` | Invalid file path | Path contains invalid chars |

**Rust Signature**:
```rust
#[tauri::command]
async fn save_file(
    document_id: String,
    content: String,
    path: Option<String>
) -> Result<SaveResult, FileError>;
```

---

### `save_file_dialog`

Opens native save dialog for new files or Save As.

**Request**:
```typescript
invoke('save_file_dialog', {
  documentId: string,
  content: string,
  suggestedName?: string
})
```

**Response**:
```typescript
interface SaveResult | null  // null if cancelled
```

**Rust Signature**:
```rust
#[tauri::command]
async fn save_file_dialog(
    window: Window,
    document_id: String,
    content: String,
    suggested_name: Option<String>
) -> Result<Option<SaveResult>, FileError>;
```

---

### `create_document`

Creates a new empty document in memory.

**Request**:
```typescript
invoke('create_document', {})
```

**Response**:
```typescript
interface Document {
  id: string;
  path: null;
  content: '';
  encoding: 'UTF-8';
  isModified: false;
  lastSaved: null;
  fileSize: null;
}
```

**Rust Signature**:
```rust
#[tauri::command]
fn create_document() -> Document;
```

---

### `close_document`

Closes a document and cleans up resources.

**Request**:
```typescript
invoke('close_document', {
  documentId: string,
  discardChanges: boolean
})
```

**Response**:
```typescript
interface CloseResult {
  success: boolean;
  draftDeleted: boolean;
}
```

**Notes**:
- If `discardChanges: false` and document modified, returns error
- Deletes associated draft if `discardChanges: true`

**Rust Signature**:
```rust
#[tauri::command]
async fn close_document(
    document_id: String,
    discard_changes: bool
) -> Result<CloseResult, FileError>;
```

---

### `check_file_modified`

Checks if file was modified externally.

**Request**:
```typescript
invoke('check_file_modified', { path: string })
```

**Response**:
```typescript
interface FileModifiedResult {
  modified: boolean;
  lastModified: number;  // File mtime
  currentMtime: number;  // Stored mtime
}
```

**Rust Signature**:
```rust
#[tauri::command]
async fn check_file_modified(path: String) -> Result<FileModifiedResult, FileError>;
```

---

### `reload_file`

Reloads file content from disk.

**Request**:
```typescript
invoke('reload_file', { path: string })
```

**Response**:
```typescript
interface Document
```

**Rust Signature**:
```rust
#[tauri::command]
async fn reload_file(path: String) -> Result<Document, FileError>;
```

---

## Error Types

```rust
// src-tauri/src/commands/file.rs

#[derive(Debug, Serialize, Deserialize)]
pub enum FileError {
    FileNotFound { path: String },
    PermissionDenied { path: String },
    EncodingError { path: String, detected: String },
    FileTooLarge { path: String, size: u64 },
    DiskFull,
    InvalidPath { path: String },
    IoError { message: String },
}
```

---

## Frontend Service

```typescript
// src/services/fileService.ts

import { invoke } from '@tauri-apps/api/core';

export const fileService = {
  async openFile(path: string): Promise<OpenFileResult> {
    return invoke('open_file', { path });
  },

  async openFileDialog(): Promise<OpenFileResult | null> {
    return invoke('open_file_dialog', {});
  },

  async saveFile(documentId: string, content: string, path?: string): Promise<SaveResult> {
    return invoke('save_file', { documentId, content, path });
  },

  async saveFileDialog(documentId: string, content: string, suggestedName?: string): Promise<SaveResult | null> {
    return invoke('save_file_dialog', { documentId, content, suggestedName });
  },

  async createDocument(): Promise<Document> {
    return invoke('create_document', {});
  },

  async closeDocument(documentId: string, discardChanges: boolean): Promise<CloseResult> {
    return invoke('close_document', { documentId, discardChanges });
  },

  async checkFileModified(path: string): Promise<FileModifiedResult> {
    return invoke('check_file_modified', { path });
  },

  async reloadFile(path: string): Promise<Document> {
    return invoke('reload_file', { path });
  },
};
```
