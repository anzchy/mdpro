---
description: Undocumented patterns — Zustand store conventions, Tauri IPC layering, plugin structure, MCP shadow store, error handling, file size limit.
---

# 50 - Codebase Conventions

Undocumented patterns found across the codebase. Follow these for consistency.

## 1. Zustand Store Conventions

**Naming:** `use[Name]Store` for the hook, file named `[name]Store.ts` in `src/stores/`.

**Creation (without middleware):**
```ts
export const useDocumentStore = create<DocumentState>((set, get) => ({ ... }));
```

**In components:** Never destructure store values at the top level of a component.
Use `useXStore((state) => state.field)` for subscriptions, `useXStore.getState()` in
callbacks and event handlers to avoid stale closures.

**Reset in tests:** Call `useXStore.setState({ ... })` in `beforeEach` to isolate tests.

## 2. Tauri IPC Pattern

Every Tauri command follows the same 3-layer flow:

| Layer | File | Responsibility |
|-------|------|----------------|
| Rust command | `src-tauri/src/commands/<module>.rs` | Business logic, returns `Result<T, String>` |
| Registration | `src-tauri/src/commands/mod.rs` → `handlers()` | Registers with Tauri |
| TS wrapper | `src/services/<service>.ts` | Typed `invoke()` call, error handling |

**Command signature (Rust):**
```rust
#[tauri::command]
pub async fn my_command(arg: String) -> Result<MyData, String> {
    do_thing(&arg).map_err(|e| format!("Failed: {}", e))
}
```

**Never panic on user input.** All commands return `Result<T, String>`.

## 3. Tauri Event Pattern

Rust → Frontend events use `app_handle.emit("event:name", &payload)`.
Frontend listens with `listen("event:name", handler)` and stores the unlisten fn
for cleanup in `useEffect` return.

**Event naming convention** (matches CLAUDE.md):
- `menu:action` — native menu clicks
- `file:open`, `file:changed` — file lifecycle
- `mcp:write_document`, `mcp:insert_content` — MCP-triggered editor mutations
- `theme:changed` — system theme

## 4. Plugin Structure (Milkdown + CodeMirror)

Plugins live in `src/plugins/` with three subdirectories:

| Directory | For |
|-----------|-----|
| `src/plugins/core/` | Config and registry |
| `src/plugins/milkdown/` | WYSIWYG (Milkdown/ProseMirror) plugins |
| `src/plugins/codemirror/` | Source editor (CodeMirror 6) plugins |

Each plugin exports either a `milkdownPlugin` (for WYSIWYG) or a `codemirrorExtension`
(for source mode). Register in `src/plugins/index.ts` and configure defaults in
`src/plugins/core/pluginConfig.ts`.

**Plugin styles** live co-located with the plugin file. Never add plugin CSS to global stylesheets.

## 5. MCP Shadow Store

The MCP layer uses a shadow store (in-memory Rust state) to bridge the async gap
between frontend edits and MCP tool calls:

- Frontend syncs to Rust via `mcp_sync_documents` (debounced 300ms for content,
  immediate for open/close/switch events)
- MCP tool calls (`read_document`, `write_document`) operate on this shadow store
- `write_document` emits `mcp:write_document` event → frontend applies to editor

**Never access document content directly from files** in MCP handlers — always go
through the shadow store (`src-tauri/src/services/shadow_store.rs`).

## 6. Error Handling

**TypeScript:** Always narrow `unknown` errors:
```ts
error instanceof Error ? error.message : String(error)
```

**Rust:** Convert errors with `.map_err()`:
```rust
fs::read(path).map_err(|e| format!("Failed to read: {}", e))?;
```

Never use `error as Error` (unsafe cast).

## 7. Logging

See CLAUDE.md § "Logging Rules" for the full pattern.

**Quick reference:**
- Frontend: `loggingService.logEventSync({ level, event, status, actionId, context })`
- Rust: `logger::log_event(LogEntryPayload { level, event, status, ... })`
- Every significant operation logs `Start` + `Success`/`Fail` with an `action_id`

Never use `console.log` for debug output in committed code. Use the logging service.

## 8. File Size Limit

Keep source files under **300 lines** (CLAUDE.md rule). When a file approaches
this limit, extract by type:
- Types/interfaces → `types.ts` in the same directory
- Pure helpers → `utils.ts`
- Sub-components → new `ComponentName.tsx`
- Custom hooks → `useFeatureName.ts`
