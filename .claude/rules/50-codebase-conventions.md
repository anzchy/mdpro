---
description: Codebase conventions — Zustand stores, feature locality, Tauri IPC layering, plugin structure and registry, MCP shadow store, error handling, file size limit.
---

# 50 - Codebase Conventions

Undocumented patterns found across the codebase. Follow these for consistency.

**Keep features local; avoid cross-feature imports unless the code is shared** — cross-feature imports couple features that should change independently.

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
| Rust command | `src-tauri/src/commands/<module>.rs` | Business logic, returns `Result` |
| Registration | `src-tauri/src/commands/mod.rs` → `handlers()` | Registers with Tauri |
| TS wrapper | `src/services/<service>.ts` | Typed `invoke()` call, error handling |

**Return `Result` from every command and never panic on user input** — a panic takes down the command instead of surfacing an error; the error type is `String` or a `Serialize` enum such as `FileError`.

## 3. Plugin Structure (Milkdown + CodeMirror)

Plugins live in `src/plugins/` with three subdirectories:

| Directory | For |
|-----------|-----|
| `src/plugins/core/` | Config and registry |
| `src/plugins/milkdown/` | WYSIWYG (Milkdown/ProseMirror) plugins |
| `src/plugins/codemirror/` | Source editor (CodeMirror 6) plugins |

Each plugin exports either a `milkdownPlugin` (for WYSIWYG) or a `codemirrorExtension`
(for source mode). Register in `src/plugins/index.ts` and configure defaults in
`src/plugins/core/pluginConfig.ts`.

Plugin lifecycle is managed by `pluginRegistry` (`src/plugins/core/pluginRegistry.ts`), initialized
in `src/components/Editor/Editor.tsx` (source mode). `src/components/Editor/MilkdownEditor.tsx`
imports its `*MilkdownPlugin` exports directly rather than through the registry.
Editor events (`docChange` / `selectionChange` / `focusChange`) are emitted via
`pluginRegistry.emitEvent` and exposed to plugins through `EditorContext.events`.

**Plugin styles** live co-located with the plugin file. Never add plugin CSS to global stylesheets.

## 4. MCP Shadow Store

The MCP layer uses a shadow store (in-memory Rust state) to bridge the async gap
between frontend edits and MCP tool calls:

- Frontend syncs to Rust via `mcp_sync_documents` (debounced 300ms for content,
  immediate for open/close/switch events)
- MCP tool calls (`read_document`, `write_document`) operate on this shadow store
- `write_document` emits `mcp:write_document` event → frontend applies to editor

**Never access document content directly from files** in MCP handlers — always go
through the shadow store (`src-tauri/src/services/shadow_store.rs`).

## 5. Error Handling

**TypeScript:** narrow `unknown` with `error instanceof Error ? error.message : String(error)` — never `error as Error` (unsafe cast).
**Rust:** convert errors with `.map_err()`.

## 6. File Size Limit

Keep source files under **300 lines**. When a file approaches
this limit, extract by type:
- Types/interfaces → `types.ts` in the same directory
- Pure helpers → `utils.ts`
- Sub-components → new `ComponentName.tsx`
- Custom hooks → `useFeatureName.ts`
