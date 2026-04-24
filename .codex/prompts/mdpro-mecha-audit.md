---
description: Read-only mdpro deep audit across rotating or selected dimensions.
argument-hint: "[dimensions: e.g. 2,7,11 | empty=random by current minute]"
---

# mdpro Deep Audit

Do not edit files. Audit only the selected dimensions.

If arguments are empty, use the current UTC minute as a seed:

```text
start = minute % 17
walk forward, wrapping around, picking every other dimension until 5 are selected
```

If arguments contain numbers, audit exactly those dimensions.

## Dimensions

1. Keyboard shortcut sync
   Files: `src-tauri/src/menu.rs`, `src/types/preferences.ts`, `docs/guide/keyboard-shortcuts.md`
   Check: menu accelerators, default preferences, docs, and new handlers stay aligned.

2. Zustand anti-patterns
   Files: `src/stores/*.ts`, `src/components/**/*.tsx`, `src/hooks/*.ts`
   Check: no top-level store destructuring in components, fresh `getState()` in callbacks, tests reset state, stores use explicit generics.

3. IPC trust boundaries
   Files: `src-tauri/src/commands/*.rs`
   Check: input validation, no unwrap/expect on user input, commands return `Result<T, String>`, MCP args validated.

4. Rust backend safety
   Files: `src-tauri/src/**/*.rs`
   Check: no panic on user-derived values, no unchecked indexing, errors propagated with `?` or `map_err`.

5. Draft and auto-save races
   Files: `src/hooks/useAutoSave.ts`, `src-tauri/src/services/draft.rs`, `src-tauri/src/commands/draft.rs`
   Check: timers cancel on close, drafts do not overwrite newer content, writes are atomic.

6. File watcher correctness
   Files: `src-tauri/src/services/file_watcher.rs`, `src/hooks/useFileWatcher.ts`
   Check: debounce, cleanup, self-trigger protection, platform assumptions.

7. Milkdown WYSIWYG edge cases
   Files: `src/plugins/milkdown/*.ts`, `src/hooks/useMilkdown.ts`
   Check: init/unmount races, schema conflicts, dispatch after destroy, cleanup, circular imports.

8. CodeMirror source mode edge cases
   Files: `src/plugins/codemirror/*.ts`, `src/components/Editor/`
   Check: IME composition, multi-cursor behavior, duplicate facets, circular dependencies.

9. Plugin CSS isolation
   Files: `src/plugins/**/*.css`, `src/styles/*.css`
   Check: plugin CSS is colocated, scoped, uses CSS variables, and does not bleed globally.

10. MCP shadow store correctness
    Files: `src-tauri/src/services/shadow_store.rs`, `src-tauri/src/commands/mcp.rs`
    Check: open/close sync, stale content, serializable events, mutex/deadlock risk.

11. Type safety
    Files: `src/**/*.ts`, `src/**/*.tsx`
    Check: `any`, unsafe casts, `(e as Error).message`, missing optional guards, exported return types.

12. Logging completeness
    Files: recently modified `src/**/*.ts`, `src-tauri/src/**/*.rs`
    Check: Start plus Success/Fail logs, no console/println/eprintln, actionId present.

13. Test coverage gaps
    Files: stores, hooks, services, plugins
    Check: corresponding tests, bug regression tests, explicit assertions, no logic snapshots.

14. Dead code
    Files: `src/**/*.ts(x)`, `src-tauri/src/**/*.rs`
    Check: unused exports/imports, unreachable branches, orphaned CSS, unused deps.

15. Export and HTML rendering
    Files: `src/services/exportService.ts`, `src-tauri/src/commands/export.rs`, `src-tauri/src/services/html_template.rs`, `src-tauri/src/services/markdown.rs`
    Check: sanitization, image paths, filename collisions, write errors, XSS vectors.

16. Dependency health
    Files: `package.json`, `src-tauri/Cargo.toml`
    Check: known CVEs, deprecated APIs, risky upgrades.

17. Version file sync
    Files: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
    Check: all three version strings match.

## Output

Announce selected dimensions:

```text
Auditing dimensions: [list] - [names]
```

For each finding:

```markdown
### [SEVERITY] Dimension: short problem
**File**: `path/to/file.ts` (line N)
**Impact**: what breaks or what risk this creates
**Fix**: concrete change needed
```

Severity:
- BLOCK: data loss, security, or silent failure
- MUST: rule violation or correctness issue
- SHOULD: code quality or test gap
- NOTE: observation only

If a dimension has no findings, write `Dimension - clean`.

End with:

```markdown
| Dimension | Findings | Highest Severity |
| --- | --- | --- |
```

