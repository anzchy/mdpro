# 30 - Pre-Landing Review Checklist

Run this checklist on every diff before marking work complete. The `auditor` agent and `/ship` command both reference this file.

## Critical Pass (Must Fix Before Landing)

Findings in this category are **blockers**. Do not commit until resolved.

### IPC Trust Boundaries

- [ ] Tauri commands (`#[tauri::command]`) never trust frontend input without validation. Paths, IDs, and strings from JS must be sanitized or validated in Rust.
- [ ] Commands return `Result<T, String>` — never `unwrap()` or `expect()` on user-supplied data.
- [ ] MCP tool handlers validate all incoming arguments before touching the shadow store or emitting events.
- [ ] Events emitted to frontend (`app_handle.emit(...)`) contain only serializable, non-secret data.

### Race Conditions

- [ ] Async Tauri commands that touch shared state (file watcher, shadow store, draft timer) are properly guarded with `Mutex` or `Arc<RwLock>`.
- [ ] Frontend `listen()` handlers that close over Zustand state use `useXStore.getState()` (not captured values) to avoid stale closures.
- [ ] Auto-save timer (`useAutoSave.ts`) cancellation is handled correctly on document close — no save fires after close.
- [ ] File watcher events are debounced; rapid external changes don't queue multiple conflicting reloads.

### Data Loss Paths

- [ ] Save operations (`save_file`) handle write errors and surface them to the user — never silently discard dirty content.
- [ ] Draft recovery (`save_draft`, `load_draft`) does not overwrite a newer version with an older draft.
- [ ] Document close with unsaved changes prompts the user — no silent discard.
- [ ] Encoding detection fallback (`encoding.rs`) produces readable output; does not silently corrupt binary-adjacent content.

### Enum and Union Completeness

- [ ] `match` statements in Rust cover all arms — no `_ => {}` that silently drops cases.
- [ ] TypeScript discriminated unions are exhaustively handled — no implicit fallthrough.
- [ ] New `menu:action` values in `menu.rs` have a corresponding handler in `useMenuEvents.ts`.

---

## Informational Pass (Should Fix, Not Blockers)

### Code Quality

- [ ] No `console.log` in committed TypeScript — use `loggingService.logEventSync()`.
- [ ] No `println!` or `eprintln!` in committed Rust — use `logger::log_event()`.
- [ ] No magic numbers — constants are named.
- [ ] No dead code — unused imports, variables, or exports removed.
- [ ] Files stay under ~300 lines — extract if approaching limit.

### Test Coverage Gaps

- [ ] New store actions have corresponding store tests.
- [ ] New hooks have `renderHook` tests.
- [ ] New Rust commands have unit tests in `src-tauri/src/commands/<module>.rs`.
- [ ] Bug fixes have regression tests (test that fails without the fix, passes with it).

### Documentation Sync

- [ ] New IPC commands are listed in the CLAUDE.md IPC table.
- [ ] Changed keyboard shortcuts are updated in all 3 locations (rule 41).
- [ ] New features have structured logging following rule 20.

---

## Severity Rubric

| Label | Meaning | Action |
|-------|---------|--------|
| **BLOCK** | Data loss, security, or silent failure | Must fix before commit |
| **MUST** | Rule violation or correctness issue | Fix in this PR |
| **SHOULD** | Code quality or test gap | Fix now if cheap; file issue if not |
| **NOTE** | Observation, no action required | Document in PR description |
