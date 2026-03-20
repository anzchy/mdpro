---
name: tauri-app-dev
description: Tauri 2.0 development patterns for mdpro — commands, events, IPC, dialogs, file watching, and app lifecycle.
---

# Tauri App Dev Skill

Reference guide for building features in mdpro's Tauri 2.0 backend (`src-tauri/`).

---

## 1. Command Pattern (Frontend → Rust)

Every new feature follows the **3-layer IPC flow** (see also `rules/50-codebase-conventions.md`):

### Step 1: Define the Rust command

```rust
// src-tauri/src/commands/my_feature.rs
use tauri::AppHandle;

#[tauri::command]
pub async fn my_command(
    app: AppHandle,
    arg: String,
) -> Result<MyData, String> {
    do_thing(&arg)
        .map_err(|e| format!("my_command failed: {}", e))
}
```

Rules:
- Always return `Result<T, String>` — never panic on user input
- Use `AppHandle` (not `Window`) for commands that don't target a specific window
- Keep business logic in `src-tauri/src/services/` — commands are thin wrappers

### Step 2: Register in mod.rs

```rust
// src-tauri/src/commands/mod.rs
pub mod my_feature;

pub fn handlers() -> impl Fn(tauri::Invoke) {
    tauri::generate_handler![
        // ... existing handlers ...
        my_feature::my_command,
    ]
}
```

### Step 3: Create TypeScript wrapper

```typescript
// src/services/myFeatureService.ts
import { invoke } from '@tauri-apps/api/core';

export interface MyData { /* ... */ }

export async function myCommand(arg: string): Promise<MyData> {
  return invoke<MyData>('my_command', { arg });
}
```

---

## 2. Event Pattern (Rust → Frontend)

### Emit from Rust

```rust
// Emit to all windows
app_handle.emit("feature:event", &payload)?;

// Or emit to a specific window
window.emit("feature:event", &payload)?;
```

### Listen in React (hook pattern)

```typescript
// src/hooks/useFeatureEvents.ts
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

export function useFeatureEvents() {
  useEffect(() => {
    const unlisten = listen<MyPayload>('feature:event', (event) => {
      // handle event.payload
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);
}
```

**Event naming convention:**
- `menu:action` — native menu clicks
- `file:open`, `file:changed` — file lifecycle
- `mcp:write_document`, `mcp:insert_content` — MCP mutations
- `theme:changed` — system theme
- `feature:verb` — new events follow this pattern

---

## 3. File Dialogs (rfd crate)

```rust
use rfd::FileDialog;

// Open file dialog
let path = FileDialog::new()
    .add_filter("Markdown", &["md", "markdown"])
    .pick_file();

// Save dialog
let path = FileDialog::new()
    .add_filter("Markdown", &["md"])
    .save_file();
```

rfd shows a **blocking native dialog**. Run in a spawned task if called from async context:

```rust
let path = tokio::task::spawn_blocking(|| {
    FileDialog::new().pick_file()
}).await.unwrap();
```

---

## 4. File Watching (notify crate)

mdpro's file watcher is in `src-tauri/src/services/file_watcher.rs`.

To watch a new path:

```rust
// Get the watcher from app state
let watcher = app.state::<FileWatcher>();
watcher.watch(path)?;
```

The watcher emits `file:changed` events to the frontend with `{ path, changeType }` payload.

---

## 5. App Lifecycle

### Single instance + file association

Handled in `src-tauri/src/launch.rs`. When the app is already running and a `.md` file is opened from Finder:
1. Existing instance receives `file:open` event with `Vec<String>` paths
2. `useFileOpen` hook in the frontend handles this event

### AppHandle vs Window

- Use `AppHandle` when your command doesn't need to target a specific window
- Use `WebviewWindow` when you need to call `window.emit()` or manipulate window state
- Get a window by label: `app.get_webview_window("main").unwrap()`

---

## 6. Development Workflow

```bash
# Start full dev environment (Tauri + Vite)
pnpm tauri dev

# Frontend only (faster, no Tauri APIs)
pnpm dev    # → http://localhost:1420/

# Check Rust compilation without running
cd src-tauri && cargo check

# Run Rust tests
cd src-tauri && cargo test

# Format Rust code
cd src-tauri && cargo fmt

# Lint
cd src-tauri && cargo clippy
```

**When to use `pnpm dev` vs `pnpm tauri dev`:**

| Scenario | Use |
|----------|-----|
| React/UI/component bugs | `pnpm dev` + browser DevTools |
| Tauri IPC, file ops, native menus | `pnpm tauri dev` |
| Debugging MCP server | `pnpm tauri dev` + `tail -f ~/.mdpro/mdpro.log` |

---

## 7. Logging in Rust

```rust
use tauri_app_lib::services::logger;
use tauri_app_lib::models::{LogEntryPayload, LogLevel, LogStatus};
use serde_json::json;

let start = std::time::Instant::now();
logger::log_event(LogEntryPayload {
    level: LogLevel::Info,
    event: "feature.action".to_string(),
    status: LogStatus::Start,
    action_id: None,
    context: Some(json!({ "path": path })),
    duration_ms: None,
    error: None,
});

// ... do work ...

logger::log_event(LogEntryPayload {
    level: LogLevel::Info,
    event: "feature.action".to_string(),
    status: LogStatus::Success,
    action_id: None,
    context: Some(json!({ "result": "ok" })),
    duration_ms: Some(start.elapsed().as_millis() as u64),
    error: None,
});
```

Logs go to `~/.mdpro/mdpro.log` in JSONL format.

---

## 8. Production Build

```bash
pnpm tauri build   # → src-tauri/target/release/bundle/dmg/
```

The output is a `.dmg` for distribution. Before building:
1. Bump version in all 3 files (see `rules/40-version-bump.md`)
2. Run `pnpm build && cargo check` to verify no errors
3. Tag the commit: `git tag vX.Y.Z`
