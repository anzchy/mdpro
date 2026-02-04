# IPC Contracts: Auto-Save Commands

**Feature**: Streamlined Auto-Save (FR-010 to FR-014)
**Module**: `src-tauri/src/commands/file.rs` (MODIFIED)

## Commands

### `save_document_silent`

Saves a document without showing any dialogs. Used for auto-save and Cmd+S on existing files.

**Direction**: Frontend → Backend

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `document_id` | `string` | Yes | ID of the document to save |
| `content` | `string` | Yes | Document content to save |
| `force` | `boolean` | No | Force save even if file unchanged (default: false) |

**Returns**:

```typescript
interface SaveDocumentSilentResult {
  success: boolean;
  /** Path where file was saved */
  path: string;
  /** Timestamp of save */
  savedAt: number;
  /** Bytes written */
  bytesWritten: number;
}
```

**Errors**:

| Code | Description |
|------|-------------|
| `DOCUMENT_NOT_FOUND` | No document with given ID |
| `NO_FILE_PATH` | Document has never been saved (use Save As) |
| `PERMISSION_DENIED` | Cannot write to file |
| `DISK_FULL` | Insufficient disk space |
| `FILE_CHANGED_EXTERNALLY` | File was modified outside the app |

**Rust Signature**:

```rust
#[tauri::command]
pub async fn save_document_silent(
    document_id: String,
    content: String,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> Result<SaveDocumentSilentResult, CommandError>
```

**Usage Example**:

```typescript
// src/hooks/useAutoSave.ts
import { invoke } from '@tauri-apps/api/core';

export async function saveSilently(documentId: string, content: string): Promise<boolean> {
  try {
    await invoke<SaveDocumentSilentResult>('save_document_silent', {
      document_id: documentId,
      content,
    });
    return true;
  } catch (error) {
    if (error.code === 'NO_FILE_PATH') {
      // Trigger Save As dialog
      return false;
    }
    throw error;
  }
}
```

---

### `get_auto_save_config`

Retrieves the user's auto-save configuration.

**Direction**: Frontend → Backend

**Parameters**: None

**Returns**:

```typescript
interface AutoSaveConfig {
  enabled: boolean;
  /** Interval in milliseconds (5000, 15000, 60000) */
  intervalMs: 5000 | 15000 | 60000;
  /** Debounce delay in milliseconds */
  debounceMs: number;
  /** Whether to save on window blur */
  saveOnBlur: boolean;
}
```

**Rust Signature**:

```rust
#[tauri::command]
pub async fn get_auto_save_config(
    state: State<'_, AppState>,
) -> Result<AutoSaveConfig, CommandError>
```

---

### `set_auto_save_config`

Updates the user's auto-save configuration.

**Direction**: Frontend → Backend

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `config` | `AutoSaveConfig` | Yes | New auto-save configuration |

**Returns**:

```typescript
interface SetAutoSaveConfigResult {
  success: boolean;
}
```

**Validation**:
- `intervalMs` must be one of: 5000, 15000, 60000
- `debounceMs` must be between 500 and 5000

**Rust Signature**:

```rust
#[tauri::command]
pub async fn set_auto_save_config(
    config: AutoSaveConfig,
    state: State<'_, AppState>,
) -> Result<SetAutoSaveConfigResult, CommandError>
```

---

### `check_file_modified`

Checks if a file has been modified externally since last save/load.

**Direction**: Frontend → Backend

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `document_id` | `string` | Yes | ID of the document to check |

**Returns**:

```typescript
interface CheckFileModifiedResult {
  /** Whether file was modified externally */
  modified: boolean;
  /** Last modification time on disk */
  diskModifiedAt: number;
  /** Last known modification time in app */
  appModifiedAt: number;
}
```

**Usage**: Call before auto-save to prevent overwriting external changes.

---

## Events

### `auto-save:triggered`

Emitted when auto-save is about to execute.

**Direction**: Frontend → Frontend (internal)

**Payload**:

```typescript
interface AutoSaveTriggeredEvent {
  documentId: string;
  trigger: 'debounce' | 'interval' | 'blur';
}
```

---

### `auto-save:completed`

Emitted when auto-save completes (success or failure).

**Direction**: Frontend → Frontend (internal)

**Payload**:

```typescript
interface AutoSaveCompletedEvent {
  documentId: string;
  success: boolean;
  error?: string;
  savedAt?: number;
}
```

---

### `file:external-change`

Emitted when external file modification is detected.

**Direction**: Backend → Frontend

**Payload**:

```typescript
interface FileExternalChangeEvent {
  documentId: string;
  path: string;
  changeType: 'modified' | 'deleted';
}
```

**Frontend Handling**:
- Show dialog with "Reload" and "Restore" options (FR-012)
- "Reload": Load content from disk
- "Restore": Keep editor content, mark as dirty

---

## Frontend Implementation

### useAutoSave Hook

```typescript
// src/hooks/useAutoSave.ts

interface UseAutoSaveOptions {
  documentId: string;
  content: string;
  filePath: string | null;
  onSaveStart?: () => void;
  onSaveComplete?: (success: boolean) => void;
  onError?: (error: Error) => void;
}

export function useAutoSave(options: UseAutoSaveOptions) {
  const [saveInProgress, setSaveInProgress] = useState(false);
  const config = useAutoSaveConfig();
  const debouncedSave = useRef<NodeJS.Timeout>();
  const lastContent = useRef<string>(options.content);

  // Debounced save on content change
  useEffect(() => {
    if (!config.enabled || !options.filePath) return;
    if (options.content === lastContent.current) return;

    // Clear existing timer
    if (debouncedSave.current) {
      clearTimeout(debouncedSave.current);
    }

    // Set new debounce timer
    debouncedSave.current = setTimeout(async () => {
      if (saveInProgress) return; // Prevent double-save

      setSaveInProgress(true);
      options.onSaveStart?.();

      try {
        await saveSilently(options.documentId, options.content);
        lastContent.current = options.content;
        options.onSaveComplete?.(true);
      } catch (error) {
        options.onError?.(error as Error);
        options.onSaveComplete?.(false);
      } finally {
        setSaveInProgress(false);
      }
    }, config.debounceMs);

    return () => {
      if (debouncedSave.current) {
        clearTimeout(debouncedSave.current);
      }
    };
  }, [options.content, config.debounceMs, config.enabled, saveInProgress]);

  // Save on blur
  useEffect(() => {
    if (!config.enabled || !config.saveOnBlur || !options.filePath) return;

    const handleBlur = async () => {
      if (saveInProgress) return;
      if (options.content === lastContent.current) return;

      setSaveInProgress(true);
      try {
        await saveSilently(options.documentId, options.content);
        lastContent.current = options.content;
      } finally {
        setSaveInProgress(false);
      }
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [config.saveOnBlur, config.enabled, saveInProgress, options.content]);

  return { saveInProgress };
}
```

### Status Indicator Component

```tsx
// Minimalist "Saved" indicator
function SaveStatusIndicator({ saveInProgress, lastSaved }: Props) {
  if (saveInProgress) {
    return <span className="text-gray-400">Saving...</span>;
  }

  if (lastSaved) {
    return (
      <span className="text-gray-500">
        Saved {formatRelativeTime(lastSaved)}
      </span>
    );
  }

  return null;
}
```

### Error Toast

```typescript
// Non-blocking toast for save errors
function showSaveErrorToast(error: Error) {
  toast.error(`Auto-save failed: ${error.message}`, {
    duration: 5000,
    action: {
      label: 'Retry',
      onClick: () => retryLastSave(),
    },
  });
}
```

---

## Implementation Notes

### Cmd+S Handling

```typescript
// In useMenuEvents.ts
case 'save':
  if (document.filePath) {
    // Existing file: silent save
    await saveSilently(document.id, document.content);
    showSaveIndicator();
  } else {
    // New file: show Save As dialog
    await showSaveAsDialog(document);
  }
  break;
```

### External Change Detection (Rust)

```rust
// In file_watcher.rs
pub async fn check_file_modified(
    document: &Document,
) -> Result<bool, Error> {
    let metadata = fs::metadata(&document.path).await?;
    let disk_modified = metadata.modified()?;

    Ok(disk_modified > document.last_saved_at)
}
```
