# Draft Commands Contract

**Module**: `src-tauri/src/commands/draft.rs`
**Frontend Hook**: `src/hooks/useAutoSave.ts`

## Overview

Tauri IPC commands for auto-save draft management and crash recovery.

---

## Commands

### `save_draft`

Saves document content as draft.

**Request**:
```typescript
invoke('save_draft', {
  documentId: string,
  content: string,
  originalPath: string | null,
  title: string
})
```

**Response**:
```typescript
interface DraftSaveResult {
  success: boolean;
  draftPath: string;
  savedAt: number;  // Unix timestamp ms
}
```

**Notes**:
- Called automatically every 30 seconds
- Overwrites existing draft for same document
- Creates `~/.mdpro/drafts/{documentId}.draft.md`
- Creates `~/.mdpro/drafts/{documentId}.meta.json`

**Rust Signature**:
```rust
#[tauri::command]
async fn save_draft(
    document_id: String,
    content: String,
    original_path: Option<String>,
    title: String
) -> Result<DraftSaveResult, DraftError>;
```

---

### `get_draft`

Gets draft content by document ID.

**Request**:
```typescript
invoke('get_draft', { documentId: string })
```

**Response**:
```typescript
interface Draft | null
```

**Rust Signature**:
```rust
#[tauri::command]
async fn get_draft(document_id: String) -> Option<Draft>;
```

---

### `list_drafts`

Lists all unrecovered drafts (for crash recovery).

**Request**:
```typescript
invoke('list_drafts', {})
```

**Response**:
```typescript
interface DraftMetadata[] {
  id: string;
  originalPath: string | null;
  lastModified: string;  // ISO 8601
  recovered: boolean;
  title: string;
}
```

**Notes**:
- Called on app startup
- Returns drafts where `recovered: false`
- Used to prompt user for recovery

**Rust Signature**:
```rust
#[tauri::command]
async fn list_drafts() -> Vec<DraftMetadata>;
```

---

### `recover_draft`

Marks draft as recovered and returns content.

**Request**:
```typescript
invoke('recover_draft', { documentId: string })
```

**Response**:
```typescript
interface RecoverResult {
  content: string;
  originalPath: string | null;
  title: string;
}
```

**Notes**:
- Sets `recovered: true` in metadata
- Does not delete draft file (user must save explicitly)

**Rust Signature**:
```rust
#[tauri::command]
async fn recover_draft(document_id: String) -> Result<RecoverResult, DraftError>;
```

---

### `delete_draft`

Deletes draft files.

**Request**:
```typescript
invoke('delete_draft', { documentId: string })
```

**Response**:
```typescript
boolean  // true if deleted, false if not found
```

**Notes**:
- Called after successful save to original file
- Removes both `.draft.md` and `.meta.json`

**Rust Signature**:
```rust
#[tauri::command]
async fn delete_draft(document_id: String) -> bool;
```

---

### `cleanup_old_drafts`

Removes drafts older than 7 days.

**Request**:
```typescript
invoke('cleanup_old_drafts', {})
```

**Response**:
```typescript
number  // Count of deleted drafts
```

**Notes**:
- Called on app startup
- Only deletes drafts where `recovered: true`

**Rust Signature**:
```rust
#[tauri::command]
async fn cleanup_old_drafts() -> usize;
```

---

## Error Types

```rust
// src-tauri/src/commands/draft.rs

#[derive(Debug, Serialize, Deserialize)]
pub enum DraftError {
    IoError { message: String },
    NotFound { document_id: String },
    ParseError { message: String },
}
```

---

## Storage Structure

```
~/.mdpro/drafts/
├── abc123.draft.md      # Draft content
├── abc123.meta.json     # Draft metadata
├── def456.draft.md
└── def456.meta.json
```

### Meta JSON Format

```json
{
  "originalPath": "/Users/jack/notes.md",
  "lastModified": "2026-01-17T10:30:00Z",
  "recovered": false,
  "title": "My Notes"
}
```

---

## Auto-save Hook

```typescript
// src/hooks/useAutoSave.ts

import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDocumentStore } from '../stores/documentStore';
import { usePreferencesStore } from '../stores/preferencesStore';

export function useAutoSave() {
  const { activeDocument, content, isModified } = useDocumentStore();
  const { autoSaveInterval } = usePreferencesStore();
  const lastSaveRef = useRef<number>(0);

  useEffect(() => {
    if (!activeDocument || !isModified) return;

    const interval = setInterval(async () => {
      const now = Date.now();

      // Debounce: skip if saved recently
      if (now - lastSaveRef.current < autoSaveInterval * 1000 - 5000) {
        return;
      }

      try {
        await invoke('save_draft', {
          documentId: activeDocument.id,
          content,
          originalPath: activeDocument.path,
          title: extractTitle(content),
        });
        lastSaveRef.current = now;
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    }, autoSaveInterval * 1000);

    return () => clearInterval(interval);
  }, [activeDocument, content, isModified, autoSaveInterval]);
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1] : 'Untitled';
}
```

---

## Recovery Flow

```
App Startup
    │
    ▼
invoke('list_drafts')
    │
    ▼
┌─────────────────────┐
│ Drafts found?       │──No──► Normal startup
└─────────────────────┘
    │ Yes
    ▼
Show recovery dialog
    │
    ├─► User clicks "Recover"
    │       │
    │       ▼
    │   invoke('recover_draft')
    │       │
    │       ▼
    │   Load content into editor
    │   Mark document as modified
    │
    └─► User clicks "Discard"
            │
            ▼
        invoke('delete_draft')
```
