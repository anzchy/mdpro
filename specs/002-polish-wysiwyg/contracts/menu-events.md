# IPC Contract: Menu Events

**Feature**: 002-polish-wysiwyg | **Type**: Event (Rust → Frontend)

## Event: `menu:action`

Emitted when user triggers native menu items or keyboard shortcuts.

### Payload Schema

```typescript
interface MenuActionPayload {
  action: string
  value?: string
}
```

### View Mode Actions

| Action | Value | Trigger | Description |
|--------|-------|---------|-------------|
| `set-view-mode` | `split` | ⌃1 or View → Split | Switch to Split view |
| `set-view-mode` | `editor-only` | ⌃2 or View → Editor | Switch to Editor-only |
| `set-view-mode` | `preview-only` | ⌃3 or View → Preview | Switch to Preview-only |
| `set-view-mode` | `wysiwyg` | ⌃4 or View → WYSIWYG | Switch to WYSIWYG |
| `cycle-view-mode` | (none) | ⌘/ | Cycle to next view mode |

### Frontend Handler

```typescript
// src/hooks/useMenuEvents.ts

import { listen } from '@tauri-apps/api/event'
import { useEditorStore } from '../stores/editorStore'

export function useMenuEvents() {
  useEffect(() => {
    const unlisten = listen<MenuActionPayload>('menu:action', (event) => {
      const { action, value } = event.payload

      if (action === 'set-view-mode' && value) {
        useEditorStore.getState().setViewMode(value as ViewMode)
      }

      if (action === 'cycle-view-mode') {
        useEditorStore.getState().cycleViewMode()
      }
    })

    return () => { unlisten.then(fn => fn()) }
  }, [])
}
```

### Rust Emitter

```rust
// src-tauri/src/menu.rs

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "view-split" => {
            app.emit("menu:action", json!({ "action": "set-view-mode", "value": "split" }));
        }
        "view-editor" => {
            app.emit("menu:action", json!({ "action": "set-view-mode", "value": "editor-only" }));
        }
        "view-preview" => {
            app.emit("menu:action", json!({ "action": "set-view-mode", "value": "preview-only" }));
        }
        "view-wysiwyg" => {
            app.emit("menu:action", json!({ "action": "set-view-mode", "value": "wysiwyg" }));
        }
        "cycle-view" => {
            app.emit("menu:action", json!({ "action": "cycle-view-mode" }));
        }
        _ => {}
    }
}
```

---

## Menu Structure Update

### Current View Menu
```
View
├── Split View        ⌘1
├── Editor Only       ⌘2
├── Preview Only      ⌘3
└── WYSIWYG          ⌘4
```

### Updated View Menu
```
View
├── Split View        ⌃1
├── Editor Only       ⌃2
├── Preview Only      ⌃3
├── WYSIWYG          ⌃4
├── ─────────────────────
├── Cycle View Mode   ⌘/
└── Toggle Sidebar    ⌘⇧B
```

**Note**: Shortcuts changed from ⌘1-4 to ⌃1-4 to preserve ⌘1-6 for Typora-style heading shortcuts.
