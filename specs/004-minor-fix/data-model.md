# Data Model: Multi-Window Support & UI Improvements

**Feature**: 004-minor-fix
**Date**: 2026-01-25

## Entity Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        UserPreferences                          │
│  (persisted to ~/Library/Application Support/mdpro/prefs.json)  │
├─────────────────────────────────────────────────────────────────┤
│ + themeMode: ThemeMode                                          │
│ + autoSaveInterval: number                                      │
│ + defaultViewMode: ViewMode        ← [EXISTING, change default] │
│ + lastViewMode: ViewMode                                        │
│ + showSidebar: boolean                                          │
│ + enableScrollSync: boolean                                     │
│ + recentFiles: string[]                                         │
│ + windowState: WindowState         ← [DEPRECATED for multi-win] │
│ + windowStates: Map<string, WindowGeometry>  ← [NEW]            │
│ + keyboardShortcuts: KeyboardShortcuts                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      WindowGeometry [NEW]                       │
│            (per-file window position/size state)                │
├─────────────────────────────────────────────────────────────────┤
│ + x: number          (screen position)                          │
│ + y: number          (screen position)                          │
│ + width: number      (inner width in pixels)                    │
│ + height: number     (inner height in pixels)                   │
│ + lastAccessed: number (timestamp for LRU eviction)             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        ViewMode [EXISTING]                      │
├─────────────────────────────────────────────────────────────────┤
│ "split" | "editor-only" | "preview-only" | "wysiwyg"            │
│                                                                 │
│ Default: "wysiwyg" (changed from "split" per user preference)   │
└─────────────────────────────────────────────────────────────────┘
```

## Rust Models (Backend)

### WindowGeometry (New)

```rust
// src-tauri/src/models/preferences.rs

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub last_accessed: i64,  // Unix timestamp for LRU
}
```

### UserPreferences (Modified)

```rust
// src-tauri/src/models/preferences.rs

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserPreferences {
    // Existing fields...
    pub theme_mode: ThemeMode,
    pub auto_save_interval: u32,
    pub default_view_mode: ViewMode,  // Default changed to Wysiwyg
    pub last_view_mode: ViewMode,
    pub show_sidebar: bool,
    pub enable_scroll_sync: bool,
    pub recent_files: Vec<String>,
    pub keyboard_shortcuts: KeyboardShortcuts,

    // Deprecated - kept for migration
    #[serde(default)]
    pub window_state: WindowState,

    // NEW: Per-file window states
    #[serde(default)]
    pub window_states: HashMap<String, WindowGeometry>,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            theme_mode: ThemeMode::System,
            auto_save_interval: 30,
            default_view_mode: ViewMode::Wysiwyg,  // Changed default
            last_view_mode: ViewMode::Wysiwyg,
            show_sidebar: true,
            enable_scroll_sync: true,
            recent_files: Vec::new(),
            window_state: WindowState::default(),
            window_states: HashMap::new(),
            keyboard_shortcuts: KeyboardShortcuts::default(),
        }
    }
}
```

### ViewMode (Existing, Default Changed)

```rust
// src-tauri/src/models/preferences.rs

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ViewMode {
    Split,
    EditorOnly,
    PreviewOnly,
    Wysiwyg,
}

impl Default for ViewMode {
    fn default() -> Self {
        ViewMode::Wysiwyg  // Changed from Split
    }
}
```

## TypeScript Models (Frontend)

### WindowGeometry (New)

```typescript
// src/types/preferences.ts

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  lastAccessed?: number;
}
```

### UserPreferences (Modified)

```typescript
// src/types/preferences.ts

export interface UserPreferences {
  themeMode: "light" | "dark" | "system";
  autoSaveInterval: number;
  defaultViewMode: ViewMode;  // Already exists
  lastViewMode: ViewMode;
  showSidebar: boolean;
  enableScrollSync: boolean;
  recentFiles: string[];
  windowState: WindowState;  // Deprecated
  windowStates: Record<string, WindowGeometry>;  // NEW
  keyboardShortcuts: KeyboardShortcuts;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  themeMode: "system",
  autoSaveInterval: 30,
  defaultViewMode: "wysiwyg",  // Changed default
  lastViewMode: "wysiwyg",
  showSidebar: true,
  enableScrollSync: true,
  recentFiles: [],
  windowState: { width: 1200, height: 800, x: 100, y: 100, isMaximized: false },
  windowStates: {},
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
};
```

## Storage Schema

### Preferences File Location
`~/Library/Application Support/com.mdpro.app/preferences.json`

### Example JSON Structure

```json
{
  "theme_mode": "system",
  "auto_save_interval": 30,
  "default_view_mode": "wysiwyg",
  "last_view_mode": "wysiwyg",
  "show_sidebar": true,
  "enable_scroll_sync": true,
  "recent_files": [
    "/Users/jack/Documents/README.md",
    "/Users/jack/notes.md"
  ],
  "window_states": {
    "/Users/jack/Documents/README.md": {
      "x": 100,
      "y": 100,
      "width": 1200,
      "height": 800,
      "last_accessed": 1706198400
    },
    "/Users/jack/notes.md": {
      "x": 200,
      "y": 150,
      "width": 1000,
      "height": 700,
      "last_accessed": 1706194800
    }
  },
  "keyboard_shortcuts": { ... }
}
```

## Validation Rules

| Field | Rule |
|-------|------|
| `window_states` | Max 100 entries (LRU eviction) |
| `window_states.*.x` | Must be on visible screen area |
| `window_states.*.y` | Must be on visible screen area |
| `window_states.*.width` | Min: 600, Max: screen width |
| `window_states.*.height` | Min: 400, Max: screen height |
| `default_view_mode` | Must be valid ViewMode enum value |

## State Transitions

### Window Lifecycle

```
[App Launch]
    │
    ├──[No args]──→ Create window with default geometry
    │                  └── Apply defaultViewMode
    │
    └──[File arg]──→ Check window_states for file
                        │
                        ├──[Found]──→ Create window with stored geometry
                        │
                        └──[Not found]──→ Create window with default geometry
                                            └── Apply defaultViewMode

[Window Close]
    │
    └── Save current geometry to window_states[file_path]
        └── If untitled: don't persist (no path)

[File Save As]
    │
    └── Move geometry from old path to new path in window_states
```

## Migration Notes

1. **windowState → windowStates**: The single `windowState` field is deprecated. On first load after update:
   - If `window_states` is empty and `window_state` has values, ignore (don't migrate)
   - New windows will populate `window_states` going forward

2. **Default view mode**: Changed from `split` to `wysiwyg`. Existing users with explicit preference are unaffected; only new installs get the new default.
