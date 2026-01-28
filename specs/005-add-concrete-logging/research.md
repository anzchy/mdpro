# Research: Concrete Logging (JSONL)

**Feature**: 005-add-concrete-logging
**Date**: 2026-01-28

## Research Task 1: Tauri Window Events API

### Question
How to hook into window lifecycle events (open/close/focus/blur) in Tauri 2.0?

### Decision
Use `on_window_event` handler in `main.rs` combined with Tauri's `WindowEvent` enum.

### Rationale
Tauri 2.0 provides window events through the `on_window_event` closure:
- `WindowEvent::Focused(true/false)` - focus/blur
- `WindowEvent::CloseRequested` - window about to close
- `WindowEvent::Destroyed` - window fully closed

For window open events, we log when `WebviewWindowBuilder::build()` succeeds.

### Code Pattern
```rust
.on_window_event(|window, event| {
    match event {
        tauri::WindowEvent::Focused(focused) => {
            if *focused {
                log_event("window.focus", ...);
            } else {
                log_event("window.blur", ...);
            }
        }
        tauri::WindowEvent::CloseRequested { .. } => {
            log_event("window.close", ...);
        }
        _ => {}
    }
})
```

### Alternatives Considered
1. **Frontend listen via @tauri-apps/api** - Would require IPC roundtrip, adds latency
2. **Custom Tauri plugin** - Overkill for simple event logging

---

## Research Task 2: Async File Writing in Rust

### Question
Best practices for non-blocking log writes in Rust/Tauri?

### Decision
Use synchronous writes with `std::fs` but wrap in `tauri::async_runtime::spawn_blocking` for heavy operations. For individual log lines, synchronous append is acceptable since JSONL lines are small (~500 bytes).

### Rationale
- Individual log entries are small (<1KB)
- File append operations are fast on macOS (kernel buffering)
- True async file I/O in Rust requires tokio-fs, which adds complexity
- Existing `logger.rs` uses synchronous writes without reported issues

### Code Pattern
```rust
pub fn log_entry(entry: &LogEntry) {
    let Some(path) = log_path() else { return; };
    let json = match serde_json::to_string(entry) {
        Ok(j) => j,
        Err(_) => return, // Silent failure
    };
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{}", json);
    }
}
```

### Alternatives Considered
1. **tokio::fs::File** - Requires async runtime, more complex
2. **mpsc channel + background writer** - Overkill for current scale
3. **Memory buffer + periodic flush** - Risk of data loss on crash

---

## Research Task 3: Action ID Generation

### Question
UUID v4 vs custom correlation ID strategy for `actionId`?

### Decision
Use UUID v4 for simplicity and uniqueness guarantee.

### Rationale
- UUID v4 is already a dependency (`uuid = "1"` in Cargo.toml)
- Guaranteed unique across all operations and time
- 36-char string is acceptable for log analysis
- No state management required (vs sequential IDs)

### Code Pattern
```rust
use uuid::Uuid;

fn generate_action_id() -> String {
    Uuid::new_v4().to_string()
}
```

Frontend:
```typescript
function generateActionId(): string {
    return crypto.randomUUID();
}
```

### Alternatives Considered
1. **Sequential integers** - Requires shared state, problematic with concurrent ops
2. **Timestamp-based** - Collision risk at high frequency
3. **Shorter custom IDs** - UUID is standard, tooling support is better

---

## Research Task 4: Existing Logger Integration

### Question
How to upgrade `logger.rs` without breaking existing `log_line()` calls?

### Decision
Keep `log_line()` for backward compatibility, add new `log_event()` for structured JSONL entries.

### Rationale
- Existing code uses `log_line("app setup start")` etc.
- Changing all call sites is risky and time-consuming
- Two functions can coexist: `log_line()` for simple debug, `log_event()` for structured events
- Eventually deprecate `log_line()` in favor of `log_event()` with `event: "debug.message"`

### Code Pattern
```rust
// Keep existing for backward compatibility
pub fn log_line(message: &str) {
    // Existing implementation (plaintext)
}

// New structured logging
pub fn log_event(entry: &LogEntry) {
    // JSONL implementation
}

// Convenience wrapper
pub fn log_event_simple(event: &str, status: Status, context: Option<LogContext>) {
    let entry = LogEntry {
        ts: Local::now().to_rfc3339(),
        level: Level::Info,
        event: event.to_string(),
        status,
        action_id: Uuid::new_v4().to_string(),
        context,
        duration_ms: None,
        error: None,
    };
    log_event(&entry);
}
```

### Alternatives Considered
1. **Replace all `log_line()` calls** - High risk, many changes
2. **Wrap `log_line()` to emit JSONL** - Would duplicate entries
3. **Configuration flag** - Adds complexity

---

## Research Task 5: Settings Integration

### Question
How does the existing Settings system work for adding logging controls?

### Findings
From `src-tauri/src/models/preferences.rs`:
- `UserPreferences` struct contains all settings
- Settings are persisted to `~/.mdpro/preferences.json`
- Frontend reads/writes via `get_preferences` / `save_preferences` commands

### Decision
Add `LogSettings` struct to `UserPreferences`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogSettings {
    pub enabled: bool,
    pub level: LogLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl Default for LogSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            level: LogLevel::Info,
        }
    }
}
```

Add to `UserPreferences`:
```rust
#[serde(default)]
pub logging: LogSettings,
```

---

## Summary of Decisions

| Area | Decision | Key Rationale |
|------|----------|---------------|
| Window Events | `on_window_event` handler | Native Tauri 2.0 API |
| File Writing | Synchronous append | Simple, small entries, acceptable perf |
| Action IDs | UUID v4 | Already a dependency, guaranteed unique |
| Logger Upgrade | Add `log_event()`, keep `log_line()` | Backward compatibility |
| Settings | Add `LogSettings` to `UserPreferences` | Follows existing pattern |
