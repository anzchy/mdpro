# IPC Contracts: Logging Commands

**Feature**: 005-add-concrete-logging
**Date**: 2026-01-28

## Overview

These contracts define the Tauri IPC commands for the logging system. Commands follow the existing pattern in `src-tauri/src/commands/`.

---

## Command: `log_event`

Writes a structured log entry to `~/.mdpro/mdpro.log`.

### Request

```typescript
invoke('log_event', { entry: LogEntryPayload })
```

### Payload

```typescript
interface LogEntryPayload {
    level: 'debug' | 'info' | 'warn' | 'error';
    event: string;
    status: 'start' | 'success' | 'fail' | 'cancel';
    actionId: string;
    context?: {
        screen?: string;
        controlId?: string;
        documentId?: string;
        filePath?: string;
        windowId?: string;
        windowLabel?: string;
        fileSizeBytes?: number;
        encoding?: string;
        details?: Record<string, unknown>;
    };
    durationMs?: number;
    error?: string;
}
```

### Response

```typescript
// Success: void (no return value)
// Failure: silently ignored (never throws)
```

### Rust Implementation

```rust
#[tauri::command]
pub fn log_event(entry: LogEntryPayload) {
    crate::services::logger::log_structured_event(entry);
}
```

### Notes

- Timestamp (`ts`) is added server-side for accuracy
- Command never fails; write errors are silently ignored
- Respects `logging.enabled` and `logging.level` from preferences

---

## Command: `get_logging_settings`

Retrieves current logging settings.

### Request

```typescript
const settings = await invoke<LogSettings>('get_logging_settings');
```

### Response

```typescript
interface LogSettings {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
}
```

### Rust Implementation

```rust
#[tauri::command]
pub fn get_logging_settings() -> LogSettings {
    crate::services::preferences::load_preferences()
        .map(|p| p.logging)
        .unwrap_or_default()
}
```

---

## Command: `set_logging_settings`

Updates logging settings.

### Request

```typescript
await invoke('set_logging_settings', { settings: LogSettings });
```

### Payload

```typescript
interface LogSettings {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
}
```

### Response

```typescript
// Success: void
// Failure: throws error string
```

### Rust Implementation

```rust
#[tauri::command]
pub fn set_logging_settings(settings: LogSettings) -> Result<(), String> {
    let mut prefs = crate::services::preferences::load_preferences()
        .unwrap_or_default();
    prefs.logging = settings;
    crate::services::preferences::save_preferences(&prefs)
        .map_err(|e| e.to_string())
}
```

---

## Integration with Existing Commands

### Modifications to `file.rs`

Add logging to existing file commands:

```rust
// In open_file command
pub async fn open_file(path: String, encoding: Option<String>) -> Result<OpenFileResult, String> {
    let action_id = uuid::Uuid::new_v4().to_string();
    logger::log_structured_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.open".to_string(),
        status: LogStatus::Start,
        action_id: action_id.clone(),
        context: Some(LogContext {
            file_path: Some(path.clone()),
            ..Default::default()
        }),
        ..Default::default()
    });

    let result = // ... existing implementation ...

    match &result {
        Ok(r) => logger::log_structured_event(LogEntryPayload {
            level: LogLevel::Info,
            event: "file.open".to_string(),
            status: LogStatus::Success,
            action_id,
            context: Some(LogContext {
                file_path: Some(path),
                file_size_bytes: Some(r.content.len() as u64),
                ..Default::default()
            }),
            duration_ms: Some(elapsed),
            ..Default::default()
        }),
        Err(e) => logger::log_structured_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "file.open".to_string(),
            status: LogStatus::Fail,
            action_id,
            error: Some(e.clone()),
            ..Default::default()
        }),
    }

    result
}
```

---

## Event Flow Examples

### Frontend → Backend Log Event

```
┌─────────────────┐     invoke('log_event')      ┌─────────────────┐
│    Frontend     │  ─────────────────────────>  │     Backend     │
│  (TypeScript)   │                              │     (Rust)      │
└─────────────────┘                              └────────┬────────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  ~/.mdpro/      │
                                                 │  mdpro.log      │
                                                 └─────────────────┘
```

### Backend-Only Log Event (App Lifecycle)

```
┌─────────────────┐     direct call      ┌─────────────────┐
│    main.rs      │  ────────────────>   │   logger.rs     │
│  (app events)   │                      │ log_structured  │
└─────────────────┘                      └────────┬────────┘
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │  ~/.mdpro/      │
                                          │  mdpro.log      │
                                          └─────────────────┘
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Log file not writable | Silently skip, app continues |
| Invalid JSON payload | Log error to stderr in debug mode |
| Logging disabled | Skip write, return immediately |
| Level below threshold | Skip write, return immediately |
