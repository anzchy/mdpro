---
description: Pre-landing review checklist — IPC trust boundaries, race conditions, data loss paths, enum completeness; severity rubric.
---

# 60 - Pre-Landing Review Checklist

**Run this checklist on every diff before marking work complete.** The `/ship` and `/mecha-audit` commands and `AGENTS.md` reference this file.

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

- [ ] A new IPC command that a reader needs to know about is added to the "Key commands:" list under CLAUDE.md § "Commands (Frontend → Rust)"; a new Rust→frontend event gets a row in the events table below it.
- [ ] **A diff that changes user-visible behaviour rewrites its row in `docs/feature-ledger.md` in this same commit** — new capability, state change (`Stub` → `Shipped`, `Shipped` → `Partial`), or a claim the work proved false. `pnpm ledger:check` passes, and `pnpm ledger:build` was re-run if the markdown changed.
- [ ] A new Tauri command, HTTP route, `MENU_*` id, plugin id, or store has a ledger row describing *that* surface — not a name parked on an unrelated row to turn the coverage count green.
- [ ] The diff does not contradict an `Accepted` ADR it touches on (`/usr/bin/grep -l <topic> docs/adr/*.md`). If it must, the change ships with a new ADR that supersedes the old one or the clause, never with a silent edit of the accepted record.

---

## Severity Rubric

| Label | Meaning | Action |
|-------|---------|--------|
| **BLOCK** | Data loss, security, or silent failure | Must fix before commit (a proven pre-existing High, per ADR-0121, becomes a D item with a fix-by instead; one left open after the audit cap lands only with the ADR-0129 record) |
| **MUST** | Rule violation or correctness issue | Fix in this PR |
| **SHOULD** | Code quality or test gap | Fix now if cheap; file issue if not |
| **NOTE** | Observation, no action required | Document in PR description |
