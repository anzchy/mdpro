# 20 - Logging and Docs (Local)

- Update relevant dev docs in the same change when behavior changes.
- If `docs/` contains documentation for the affected feature, keep it as the single
  source of truth and update it in the same commit.
- If `specs/` contains a spec for the feature, update `tasks.md` to mark completed
  items and note any deviations in `spec.md`.

## Logging (required for new features)

When adding a new Tauri command or significant frontend feature, add structured
logging following the patterns in CLAUDE.md § "Logging Rules":

- Rust backend: use `logger::log_event(LogEntryPayload { ... })` with `Start` +
  `Success`/`Fail` pairs and meaningful `event` names (`"feature.action"`).
- TypeScript frontend: use `loggingService.logEventSync({ ... })` with `ui.<component>.<action>` naming.
- Verify with: `tail -f ~/.mdpro/mdpro.log | jq .`

## IPC Changes

When adding or modifying a Tauri command:
1. Define in `src-tauri/src/commands/<module>.rs`
2. Register in `src-tauri/src/commands/mod.rs` → `handlers()`
3. Create typed wrapper in `src/services/<service>.ts`
4. Update `CLAUDE.md` IPC table if it's a new command
