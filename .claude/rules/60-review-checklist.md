---
description: Pre-landing review checklist — IPC trust boundaries, race conditions, data loss paths, enum completeness; severity rubric.
---

# 60 - Pre-Landing Review Checklist

Run this checklist on every diff before marking work complete. The `/ship` and `/mecha-audit` commands and `AGENTS.md` reference this file.

## Critical Pass (Must Fix Before Landing)

Findings in this category are **blockers**. Do not commit until resolved.

### IPC Trust Boundaries

- [ ] Tauri commands (`#[tauri::command]`) never trust frontend input without validation. Paths, IDs, and strings from JS must be sanitized or validated in Rust.
- [ ] Commands return `Result` (error type `String` or a `Serialize` enum such as `FileError`) — never `unwrap()` or `expect()` on user-supplied data.
- [ ] MCP tool handlers validate all incoming arguments before touching the shadow store or emitting events.
- [ ] Events emitted to frontend (`app_handle.emit(...)`) contain only serializable, non-secret data.

### Race Conditions

- [ ] Async Tauri commands that touch shared state (file watcher, shadow store, draft timer) are properly guarded with `Mutex` or `Arc<RwLock>`.
- [ ] Frontend `listen()` handlers that close over Zustand state use `useXStore.getState()` (not captured values) to avoid stale closures.
- [ ] Auto-save timer (`useAutoSave.ts`) cancellation is handled correctly on document close — no save fires after close.
- [ ] File watcher events are debounced; rapid external changes don't queue multiple conflicting reloads.

### Data Loss Paths

- [ ] Save operations (`save_file`) handle write errors and surface them to the user — never silently discard dirty content.
- [ ] Draft recovery (`save_draft`, `get_draft`, `recover_draft`) does not overwrite a newer version with an older draft.
- [ ] Document close with unsaved changes prompts the user — no silent discard.
- [ ] Encoding detection fallback (`encoding.rs`) produces readable output; does not silently corrupt binary-adjacent content.

### Enum and Union Completeness

- [ ] `match` statements in Rust cover all arms — no `_ => {}` that silently drops cases.
- [ ] TypeScript discriminated unions are exhaustively handled — no implicit fallthrough.
- [ ] New `menu:action` values in `menu.rs` have a corresponding handler in `useMenuEvents.ts`.

---

## Informational Pass (Should Fix, Not Blockers)

### Code Quality

- [ ] No `console.log` in committed TypeScript and no `println!` / `eprintln!` in committed Rust — use the logging service (rule 20).
- [ ] No magic numbers — constants are named.
- [ ] No dead code — unused imports, variables, or exports removed.

### Test Coverage Gaps

- [ ] New code has the tests rule 10's "When tests are required" table demands; bug fixes have a regression test (fails without the fix, passes with it).

### Documentation Sync

- [ ] New IPC commands are listed in the CLAUDE.md IPC table.

---

## Severity Rubric

| Label | Meaning | Action |
|-------|---------|--------|
| **BLOCK** | Data loss, security, or silent failure | Must fix before commit |
| **MUST** | Rule violation or correctness issue | Fix in this PR |
| **SHOULD** | Code quality or test gap | Fix now if cheap; file issue if not |
| **NOTE** | Observation, no action required | Document in PR description |
