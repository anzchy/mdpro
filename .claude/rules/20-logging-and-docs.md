---
description: Canonical structured-logging rule (Rust and TypeScript Start + Success/Fail examples) plus same-commit docs updates.
paths:
  - "src-tauri/src/commands/**/*.rs"
  - "src/services/**/*.ts"
  - "src/hooks/**/*.ts"
  - "src/components/**/*.tsx"
---

# 20 - Logging and Docs (Local)

**Update docs in the same commit as the behavior change**: the feature's page in `docs/guide/` and, if the feature has a spec, `specs/<NNN-name>/tasks.md` (mark items done, note deviations in `spec.md`). Docs that lag the code mislead the next reader.

## Logging (required for new features)

**Log every new Tauri command, and every frontend change that adds a store
action, a `menu:action` handler, an event listener, or a user-facing control.**
Production builds have no console, so the JSONL log is the only debugging
trail. Event naming convention and log file path: CLAUDE.md § "Logging Rules".

### Rust (`src-tauri/src/commands/`)

Emit one `Start` entry, then one `Success` or `Fail` entry for the same `event`:

```rust
use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use serde_json::json;

logger::log_event(LogEntryPayload {
    level: LogLevel::Info,
    event: "file.open".to_string(),
    status: LogStatus::Start,
    action_id: None,
    context: Some(json!({ "path": path })),
    duration_ms: None,
    error: None,
});

// Failure: level: LogLevel::Error, status: LogStatus::Fail, error: Some(message)
logger::log_event(LogEntryPayload {
    level: LogLevel::Info,
    event: "file.open".to_string(),
    status: LogStatus::Success,
    action_id: None,
    context: Some(json!({ "bytes": len })),
    duration_ms: Some(elapsed_ms),
    error: None,
});
```

From `src-tauri/src/main.rs`, import through `tauri_app_lib::models` and
`tauri_app_lib::services::logger` instead of `crate::`.

### TypeScript (`src/`)

```typescript
import { loggingService } from "../services/loggingService";

loggingService.logEventSync({
  level: "info",
  event: "ui.button.click", // ui.<component>.<action>
  status: "success", // "start" | "success" | "fail" | "cancel"
  actionId: loggingService.generateActionId(),
  context: { screen: "editor", controlId: "button-id" },
});
```
