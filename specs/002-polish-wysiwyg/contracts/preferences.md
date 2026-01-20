# IPC Contract: Preferences

**Feature**: 002-polish-wysiwyg | **Type**: Command (Frontend → Rust)

## Command: `get_preferences`

Retrieves user preferences including last used view mode.

### Request

No parameters.

### Response

```typescript
interface Preferences {
  lastViewMode: ViewMode  // NEW: "split" | "editor-only" | "preview-only" | "wysiwyg"
  theme: "light" | "dark" | "system"
  // ... existing fields
}
```

### Rust Handler

```rust
// src-tauri/src/commands/preferences.rs

#[derive(Debug, Serialize, Deserialize)]
pub struct Preferences {
    #[serde(default = "default_view_mode")]
    pub last_view_mode: String,
    pub theme: String,
    // ... existing fields
}

fn default_view_mode() -> String {
    "split".to_string()
}

#[tauri::command]
pub fn get_preferences(app: AppHandle) -> Result<Preferences, String> {
    let path = app.path().app_data_dir()?.join("preferences.json");

    if path.exists() {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&content)
            .map_err(|e| e.to_string())
    } else {
        Ok(Preferences::default())
    }
}
```

---

## Command: `save_preferences`

Persists user preferences including last used view mode.

### Request

```typescript
interface SavePreferencesRequest {
  lastViewMode?: ViewMode
  theme?: "light" | "dark" | "system"
  // ... partial update supported
}
```

### Response

```typescript
{ success: true }
```

### Rust Handler

```rust
#[tauri::command]
pub fn save_preferences(app: AppHandle, preferences: Preferences) -> Result<(), String> {
    let path = app.path().app_data_dir()?.join("preferences.json");

    // Merge with existing preferences
    let existing = get_preferences(app.clone()).unwrap_or_default();
    let merged = Preferences {
        last_view_mode: preferences.last_view_mode.or(existing.last_view_mode),
        theme: preferences.theme.or(existing.theme),
        // ...
    };

    let content = serde_json::to_string_pretty(&merged)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, content)
        .map_err(|e| e.to_string())
}
```

---

## Frontend Usage

```typescript
// src/services/preferencesService.ts

import { invoke } from '@tauri-apps/api/core'

export async function getPreferences(): Promise<Preferences> {
  return invoke('get_preferences')
}

export async function saveViewMode(viewMode: ViewMode): Promise<void> {
  await invoke('save_preferences', {
    preferences: { lastViewMode: viewMode }
  })
}
```

```typescript
// src/App.tsx - on mount

useEffect(() => {
  getPreferences().then(prefs => {
    if (prefs.lastViewMode) {
      useEditorStore.getState().setViewMode(prefs.lastViewMode)
    }
  })
}, [])

// On view mode change
useEffect(() => {
  saveViewMode(viewMode)
}, [viewMode])
```

---

## Storage Location

- **macOS**: `~/Library/Application Support/com.mdpro.app/preferences.json`

### File Format

```json
{
  "lastViewMode": "split",
  "theme": "system"
}
```
