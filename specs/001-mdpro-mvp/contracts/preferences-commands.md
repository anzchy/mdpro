# Preferences Commands Contract

**Module**: `src-tauri/src/commands/preferences.rs`
**Frontend Service**: `src/services/preferencesService.ts`

## Overview

Tauri IPC commands for managing user preferences.

---

## Commands

### `get_preferences`

Gets current user preferences.

**Request**:
```typescript
invoke('get_preferences', {})
```

**Response**:
```typescript
interface UserPreferences {
  themeMode: 'light' | 'dark' | 'system';
  autoSaveInterval: number;
  defaultViewMode: ViewMode;
  showSidebar: boolean;
  enableScrollSync: boolean;
  recentFiles: string[];
  windowState: WindowState;
}
```

**Notes**:
- Returns default preferences if config file doesn't exist
- Config stored at `~/.mdpro/config.json`

**Rust Signature**:
```rust
#[tauri::command]
async fn get_preferences() -> UserPreferences;
```

---

### `set_preferences`

Updates user preferences.

**Request**:
```typescript
invoke('set_preferences', {
  preferences: Partial<UserPreferences>
})
```

**Response**:
```typescript
interface UserPreferences  // Updated full preferences
```

**Notes**:
- Merges partial update with existing preferences
- Persists immediately to disk

**Rust Signature**:
```rust
#[tauri::command]
async fn set_preferences(
    preferences: PartialPreferences
) -> Result<UserPreferences, PreferencesError>;
```

---

### `add_recent_file`

Adds a file to recent files list.

**Request**:
```typescript
invoke('add_recent_file', { path: string })
```

**Response**:
```typescript
string[]  // Updated recent files list
```

**Notes**:
- Moves to front if already in list
- Limits to 10 most recent
- Validates path exists

**Rust Signature**:
```rust
#[tauri::command]
async fn add_recent_file(path: String) -> Vec<String>;
```

---

### `clear_recent_files`

Clears recent files list.

**Request**:
```typescript
invoke('clear_recent_files', {})
```

**Response**:
```typescript
void
```

**Rust Signature**:
```rust
#[tauri::command]
async fn clear_recent_files() -> ();
```

---

### `get_system_theme`

Gets current system theme (light/dark).

**Request**:
```typescript
invoke('get_system_theme', {})
```

**Response**:
```typescript
'light' | 'dark'
```

**Notes**:
- Uses macOS system appearance API
- Used when themeMode is 'system'

**Rust Signature**:
```rust
#[tauri::command]
fn get_system_theme() -> String;
```

---

### `save_window_state`

Saves current window dimensions and position.

**Request**:
```typescript
invoke('save_window_state', {
  windowState: WindowState
})
```

**Response**:
```typescript
void
```

**Rust Signature**:
```rust
#[tauri::command]
async fn save_window_state(window_state: WindowState) -> ();
```

---

## Error Types

```rust
// src-tauri/src/commands/preferences.rs

#[derive(Debug, Serialize, Deserialize)]
pub enum PreferencesError {
    IoError { message: String },
    ParseError { message: String },
}
```

---

## Storage Format

```json
// ~/.mdpro/config.json
{
  "themeMode": "system",
  "autoSaveInterval": 30,
  "defaultViewMode": "split",
  "showSidebar": true,
  "enableScrollSync": true,
  "recentFiles": [
    "/Users/jack/Documents/notes.md",
    "/Users/jack/Projects/README.md"
  ],
  "windowState": {
    "width": 1200,
    "height": 800,
    "x": 100,
    "y": 100,
    "isMaximized": false
  }
}
```

---

## Frontend Service

```typescript
// src/services/preferencesService.ts

import { invoke } from '@tauri-apps/api/core';

export const preferencesService = {
  async getPreferences(): Promise<UserPreferences> {
    return invoke('get_preferences', {});
  },

  async setPreferences(preferences: Partial<UserPreferences>): Promise<UserPreferences> {
    return invoke('set_preferences', { preferences });
  },

  async addRecentFile(path: string): Promise<string[]> {
    return invoke('add_recent_file', { path });
  },

  async clearRecentFiles(): Promise<void> {
    return invoke('clear_recent_files', {});
  },

  async getSystemTheme(): Promise<'light' | 'dark'> {
    return invoke('get_system_theme', {});
  },

  async saveWindowState(windowState: WindowState): Promise<void> {
    return invoke('save_window_state', { windowState });
  },
};
```
