# Research: Multi-Window Support & UI Improvements

**Feature**: 004-minor-fix
**Date**: 2026-01-25

## 1. Tauri Multi-Window Implementation

### Decision
Use Tauri 2.0's `WebviewWindowBuilder` API to create new windows dynamically from the Rust backend.

### Rationale
- Tauri 2.0 has first-class support for multi-window applications
- Each `WebviewWindow` loads the same frontend bundle but operates independently
- Windows can be created from Rust via `WebviewWindowBuilder::new()` or from JS via `WebviewWindow.create()`
- Window state (position, size) can be accessed via `window.inner_position()`, `window.inner_size()`

### Implementation Pattern

```rust
// src-tauri/src/commands/window.rs
use tauri::{AppHandle, WebviewWindowBuilder, WebviewUrl};
use uuid::Uuid;

#[tauri::command]
pub async fn create_window(app: AppHandle, file_path: Option<String>) -> Result<String, String> {
    let window_id = format!("mdpro-{}", Uuid::new_v4());

    let mut builder = WebviewWindowBuilder::new(
        &app,
        &window_id,
        WebviewUrl::default()  // Loads index.html
    )
    .title("Untitled - mdpro")
    .inner_size(1200.0, 800.0)
    .min_inner_size(600.0, 400.0);

    // Restore window position if file_path provided and state exists
    if let Some(path) = &file_path {
        if let Some(state) = get_window_state_for_file(path) {
            builder = builder
                .position(state.x as f64, state.y as f64)
                .inner_size(state.width as f64, state.height as f64);
        }
    }

    let window = builder.build().map_err(|e| e.to_string())?;

    // If file path provided, emit event to new window to open the file
    if let Some(path) = file_path {
        let _ = window.emit("file:open", vec![path]);
    }

    Ok(window_id)
}
```

### Alternatives Considered
1. **Single window with tabs** - Rejected: User explicitly requested independent windows
2. **Electron-style multi-process** - Not applicable: Tauri uses native webviews

---

## 2. Window State Persistence

### Decision
Store per-file window geometry in a separate JSON map within the preferences file. Key by file path hash.

### Rationale
- File paths can be very long; use hash for storage efficiency
- Separate from main preferences to avoid bloating the preferences object
- Limit to most recent 100 files to prevent unbounded growth

### Data Structure

```rust
// In preferences.rs
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Default)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

// Store as HashMap<String, WindowGeometry> where key is file path
// Limited to 100 entries, LRU eviction
```

### Alternatives Considered
1. **SQLite database** - Rejected: Overkill for simple key-value storage
2. **Separate file per document** - Rejected: Would create many small files

---

## 3. External File Opening (Finder Double-Click)

### Decision
Modify `RunEvent::Opened` handler in `main.rs` to always create a new window when mdpro already has document(s) open.

### Rationale
- Current implementation stores paths in `LaunchState` or emits `file:open` event
- `file:open` event currently goes to the existing window
- Need to change: when app has windows with documents, create new window instead

### Implementation Pattern

```rust
// In main.rs RunEvent::Opened handler
if !paths.is_empty() {
    // Check if any existing window has a document open
    let has_documents = check_windows_have_documents(&app_handle);

    if has_documents {
        // Create new window for each file
        for path in paths {
            let _ = create_window(app_handle.clone(), Some(path));
        }
    } else {
        // Use existing empty window
        let _ = app_handle.emit("file:open", paths);
    }
}
```

### Alternatives Considered
1. **Always open in existing window** - Rejected: User explicitly requested new windows
2. **User preference toggle** - Rejected: Adds complexity, can be added later if needed

---

## 4. Settings Page Theme Synchronization

### Decision
Make `SettingsDialog` consume `useThemeStore` and apply dynamic CSS classes based on `resolvedTheme`.

### Rationale
- `useThemeStore` already tracks the current resolved theme (light/dark)
- Settings dialog currently has hardcoded colors that don't respond to theme
- Need to add CSS variables or dynamic classes for proper theming

### Implementation Pattern

```tsx
// SettingsDialog.tsx
import { useThemeStore } from "../../stores/themeStore";

export function SettingsDialog({ ... }) {
  const { resolvedTheme } = useThemeStore();

  return (
    <div className={`settings-dialog theme-${resolvedTheme}`}>
      {/* ... */}
    </div>
  );
}
```

```css
/* settings.css */
.settings-dialog.theme-light {
  --settings-bg: #ffffff;
  --settings-text: #1a1a1a;
  --settings-sidebar-bg: #f5f5f7;
  --settings-card-bg: #ffffff;
  --settings-border: #e0e0e0;
}

.settings-dialog.theme-dark {
  --settings-bg: #1c1c1e;
  --settings-text: #ffffff;
  --settings-sidebar-bg: #2c2c2e;
  --settings-card-bg: #3a3a3c;
  --settings-border: #3a3a3c;
}
```

### Alternatives Considered
1. **Separate light/dark stylesheets** - Rejected: More files to maintain
2. **Inline styles** - Rejected: Harder to maintain, worse performance

---

## 5. Default View Mode Setting

### Decision
Add `defaultViewMode` field to `UserPreferences` with enum values: `editor`, `preview`, `split`, `wysiwyg`. Default to `wysiwyg`.

### Rationale
- Existing `ViewMode` type already defined in `src/types/editor.ts`
- Preferences already have `lastViewMode` field, `defaultViewMode` follows same pattern
- Settings UI already has placeholder for "Default view mode" in General section

### Implementation Pattern

```typescript
// types/preferences.ts - already has this field defined
export interface UserPreferences {
  // ... existing fields
  defaultViewMode: ViewMode;  // Already exists!
}
```

```rust
// models/preferences.rs
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    Editor,
    Preview,
    Split,
    #[default]
    Wysiwyg,  // Change default from Split to Wysiwyg per user preference
}
```

### Alternatives Considered
1. **Remember last used mode per-file** - Could be added later, but user wants global default first

---

## 6. Window Dragging

### Decision
No code changes needed. Tauri windows with default decorations support native macOS title bar dragging.

### Rationale
- Current `tauri.conf.json` uses default window decorations (not `decorations: false`)
- macOS native title bar automatically supports drag-to-move
- Custom title bars would require `data-tauri-drag-region` attribute, but we use native

### Verification
Tested current mdpro build - window dragging already works via native title bar.

---

## Summary of Key Findings

| Topic | Decision | Confidence |
|-------|----------|------------|
| Multi-window API | Tauri `WebviewWindowBuilder` | High |
| Window state storage | HashMap in preferences JSON | High |
| External file routing | New window when docs open | High |
| Settings theme | CSS variables + dynamic class | High |
| Default view mode | Already in preferences model | High |
| Window dragging | Native macOS - no changes | Verified |
