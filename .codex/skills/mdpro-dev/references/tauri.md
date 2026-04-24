# mdpro Tauri Reference

## Command Pattern

Every frontend to Rust feature follows a three-layer IPC flow:

1. Define the command in `src-tauri/src/commands/<module>.rs`.
2. Register it in `src-tauri/src/commands/mod.rs`.
3. Create a typed TypeScript wrapper in `src/services/<service>.ts`.

Rust command shape:

```rust
#[tauri::command]
pub async fn my_command(app: AppHandle, arg: String) -> Result<MyData, String> {
    do_thing(&arg).map_err(|e| format!("my_command failed: {}", e))
}
```

Rules:
- Commands are thin wrappers; business logic belongs in `src-tauri/src/services/`.
- Return `Result<T, String>`.
- Validate user-supplied paths, IDs, and strings.
- Do not panic on frontend input.

TypeScript wrapper shape:

```ts
import { invoke } from "@tauri-apps/api/core";

export async function myCommand(arg: string): Promise<MyData> {
  return invoke<MyData>("my_command", { arg });
}
```

## Events

Rust emits with `app_handle.emit("feature:event", &payload)?`.

React listens inside a hook and cleans up:

```ts
useEffect(() => {
  const unlisten = listen<MyPayload>("feature:event", (event) => {
    handlePayload(event.payload);
  });
  return () => {
    unlisten.then((fn) => fn());
  };
}, []);
```

Use `useXStore.getState()` inside event handlers when reading or writing Zustand state.

## File Dialogs

Use `rfd::FileDialog`.

When called from async context, run blocking dialogs in `tokio::task::spawn_blocking`.

## File Watching

File watcher service: `src-tauri/src/services/file_watcher.rs`.

Watchers emit `file:changed` events to the frontend. Check for:
- cleanup on document close
- debounce for rapid changes
- no self-triggered reload loop from mdpro writes

## App Lifecycle

Single instance and file association live in `src-tauri/src/launch.rs`.

Finder-opened `.md` files reach the existing instance through `file:open`, then frontend hooks handle them.

Use `AppHandle` unless a command truly targets a specific window.

## Rust Logging

Log Start and Success or Fail:

```rust
logger::log_event(LogEntryPayload {
    level: LogLevel::Info,
    event: "feature.action".to_string(),
    status: LogStatus::Start,
    action_id: Some(action_id.clone()),
    context: Some(json!({ "path": path })),
    duration_ms: None,
    error: None,
});
```

Logs are JSONL at `~/.mdpro/mdpro.log`.

## Commands

```bash
pnpm tauri dev
pnpm dev
cd src-tauri && cargo check
cd src-tauri && cargo test
cd src-tauri && cargo fmt
cd src-tauri && cargo clippy
pnpm tauri build
```

