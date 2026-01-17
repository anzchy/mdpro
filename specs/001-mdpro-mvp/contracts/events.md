# Events Contract

**Module**: `src-tauri/src/services/file_watcher.rs`
**Frontend Hook**: `src/hooks/useFileWatcher.ts`

## Overview

Tauri events emitted from backend to frontend for reactive updates.

---

## Events

### `file:changed`

Emitted when a watched file is modified externally.

**Payload**:
```typescript
interface FileChangedEvent {
  path: string;
  changeType: 'modified' | 'deleted' | 'renamed';
  newPath?: string;  // Only for 'renamed'
  timestamp: number;
}
```

**Usage**:
```typescript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen<FileChangedEvent>('file:changed', (event) => {
  console.log('File changed:', event.payload);
});
```

**Notes**:
- Uses `notify` crate for cross-platform file watching
- Debounced to 500ms to avoid rapid fire events
- Only emits for files currently open in editor

---

### `theme:changed`

Emitted when system theme changes (macOS appearance).

**Payload**:
```typescript
interface ThemeChangedEvent {
  theme: 'light' | 'dark';
}
```

**Usage**:
```typescript
const unlisten = await listen<ThemeChangedEvent>('theme:changed', (event) => {
  if (preferences.themeMode === 'system') {
    applyTheme(event.payload.theme);
  }
});
```

**Notes**:
- Uses macOS `NSApp.effectiveAppearance` observation
- Only relevant when `themeMode: 'system'`

---

### `draft:saved`

Emitted when auto-save completes successfully.

**Payload**:
```typescript
interface DraftSavedEvent {
  documentId: string;
  savedAt: number;
}
```

**Usage**:
```typescript
const unlisten = await listen<DraftSavedEvent>('draft:saved', (event) => {
  showToast('Draft saved');
});
```

**Notes**:
- Used for UI feedback (subtle indicator)
- Not shown as intrusive notification

---

### `window:close-requested`

Emitted when user attempts to close window.

**Payload**:
```typescript
interface CloseRequestedEvent {
  hasUnsavedChanges: boolean;
  documentIds: string[];
}
```

**Usage**:
```typescript
const unlisten = await listen<CloseRequestedEvent>('window:close-requested', async (event) => {
  if (event.payload.hasUnsavedChanges) {
    const shouldClose = await showSaveDialog();
    if (shouldClose) {
      await invoke('confirm_close');
    }
  }
});
```

**Notes**:
- Prevents window close until frontend confirms
- Allows "Save before closing?" dialog

---

## File Watcher Service

### Rust Implementation

```rust
// src-tauri/src/services/file_watcher.rs

use notify::{Watcher, RecursiveMode, watcher};
use std::sync::mpsc::channel;
use std::time::Duration;
use tauri::Manager;

pub struct FileWatcher {
    watcher: Box<dyn Watcher>,
    watched_paths: Vec<String>,
}

impl FileWatcher {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        let (tx, rx) = channel();

        let watcher = watcher(tx, Duration::from_millis(500)).unwrap();

        // Spawn event handler thread
        std::thread::spawn(move || {
            loop {
                match rx.recv() {
                    Ok(event) => {
                        let payload = FileChangedEvent::from(event);
                        app_handle.emit_all("file:changed", payload).ok();
                    }
                    Err(_) => break,
                }
            }
        });

        Self {
            watcher: Box::new(watcher),
            watched_paths: Vec::new(),
        }
    }

    pub fn watch(&mut self, path: &str) {
        self.watcher.watch(path, RecursiveMode::NonRecursive).ok();
        self.watched_paths.push(path.to_string());
    }

    pub fn unwatch(&mut self, path: &str) {
        self.watcher.unwatch(path).ok();
        self.watched_paths.retain(|p| p != path);
    }
}
```

### Frontend Hook

```typescript
// src/hooks/useFileWatcher.ts

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useDocumentStore } from '../stores/documentStore';

interface FileChangedEvent {
  path: string;
  changeType: 'modified' | 'deleted' | 'renamed';
  newPath?: string;
  timestamp: number;
}

export function useFileWatcher() {
  const { activeDocument, showReloadDialog } = useDocumentStore();

  useEffect(() => {
    const unlisten = listen<FileChangedEvent>('file:changed', (event) => {
      const { path, changeType } = event.payload;

      if (activeDocument?.path !== path) return;

      switch (changeType) {
        case 'modified':
          showReloadDialog({
            message: 'File was modified externally. Reload?',
            path,
          });
          break;

        case 'deleted':
          showReloadDialog({
            message: 'File was deleted. Save to new location?',
            path,
            isDeleted: true,
          });
          break;

        case 'renamed':
          // Update path in store
          useDocumentStore.getState().updatePath(event.payload.newPath!);
          break;
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [activeDocument?.path]);
}
```

---

## Event Registration

Events are registered in the Tauri app builder:

```rust
// src-tauri/src/main.rs

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialize file watcher
            let watcher = FileWatcher::new(app.handle());
            app.manage(watcher);

            // Set up system theme observer
            setup_theme_observer(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ... commands
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
