# Data Model: Concrete Logging (JSONL)

**Feature**: 005-add-concrete-logging
**Date**: 2026-01-28

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         LogEntry                                 │
├─────────────────────────────────────────────────────────────────┤
│ ts: string (ISO 8601)                                           │
│ level: LogLevel                                                  │
│ event: string                                                    │
│ status: LogStatus                                                │
│ actionId: string (UUID)                                          │
│ context: LogContext (optional)                                   │
│ durationMs: number (optional)                                    │
│ error: string (optional)                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ contains
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        LogContext                                │
├─────────────────────────────────────────────────────────────────┤
│ screen: string (optional)                                        │
│ controlId: string (optional)                                     │
│ documentId: string (optional)                                    │
│ filePath: string (optional)                                      │
│ windowId: string (optional)                                      │
│ windowLabel: string (optional)                                   │
│ appVersion: string (optional)                                    │
│ platform: string (optional)                                      │
│ startupTimeMs: number (optional)                                 │
│ fileSizeBytes: number (optional)                                 │
│ encoding: string (optional)                                      │
│ details: object (optional, free-form)                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        LogSettings                               │
├─────────────────────────────────────────────────────────────────┤
│ enabled: boolean (default: true)                                 │
│ level: LogLevel (default: "info")                                │
└─────────────────────────────────────────────────────────────────┘
```

## Enums

### LogLevel

```
debug < info < warn < error
```

| Value | Description |
|-------|-------------|
| `debug` | High-frequency events, verbose output |
| `info` | Normal operations (default) |
| `warn` | Recoverable issues |
| `error` | Failures requiring attention |

### LogStatus

| Value | Description |
|-------|-------------|
| `start` | Action initiated |
| `success` | Action completed successfully |
| `fail` | Action failed with error |
| `cancel` | Action cancelled by user |

## Entity Definitions

### LogEntry (Rust)

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// ISO 8601 timestamp with timezone
    pub ts: String,
    /// Log level
    pub level: LogLevel,
    /// Namespaced event name (e.g., "ui.button.click", "file.save")
    pub event: String,
    /// Event status
    pub status: LogStatus,
    /// Correlation ID for linking start/success/fail events
    pub action_id: String,
    /// Structured metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<LogContext>,
    /// Duration in milliseconds (for success/fail events)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// Error message (for fail events)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStatus {
    Start,
    Success,
    Fail,
    Cancel,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LogContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screen: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_time_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
    // External file open context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,  // "finder", "cli", "drop", "single_instance"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drop_target: Option<String>,  // "window", "tab"
    // Tab context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_document_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_document_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub was_modified: Option<bool>,
    // Window move context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_position: Option<String>,  // "x,y"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_position: Option<String>,  // "x,y"
}
```

### LogEntry (TypeScript)

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogStatus = 'start' | 'success' | 'fail' | 'cancel';

export interface LogContext {
    screen?: string;
    controlId?: string;
    documentId?: string;
    filePath?: string;
    windowId?: string;
    windowLabel?: string;
    appVersion?: string;
    platform?: string;
    startupTimeMs?: number;
    fileSizeBytes?: number;
    encoding?: string;
    details?: Record<string, unknown>;
    // External file open context
    source?: 'finder' | 'cli' | 'drop' | 'single_instance';
    dropTarget?: 'window' | 'tab';
    // Tab context
    tabIndex?: number;
    fromDocumentId?: string;
    toDocumentId?: string;
    wasModified?: boolean;
    // Window move context
    fromPosition?: string;  // "x,y"
    toPosition?: string;    // "x,y"
}

export interface LogEntry {
    ts: string;
    level: LogLevel;
    event: string;
    status: LogStatus;
    actionId: string;
    context?: LogContext;
    durationMs?: number;
    error?: string;
}
```

### LogSettings (Rust)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSettings {
    pub enabled: bool,
    pub level: LogLevel,
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

### LogSettings (TypeScript)

```typescript
export interface LogSettings {
    enabled: boolean;
    level: LogLevel;
}
```

## Event Name Registry

### UI Events

| Event Name | Description |
|------------|-------------|
| `ui.button.click` | Button clicked |
| `ui.menu.select` | Menu item selected |
| `ui.shortcut.trigger` | Keyboard shortcut triggered |
| `ui.dialog.confirm` | Dialog confirmed |
| `ui.dialog.cancel` | Dialog cancelled |
| `ui.toggle.change` | Toggle/switch changed |
| `ui.select.change` | Dropdown selection changed |
| `ui.settings.change` | Settings value changed |

### File Events

| Event Name | Description |
|------------|-------------|
| `file.open` | File opened |
| `file.save` | File saved |
| `file.write` | File written (autosave) |
| `file.export` | File exported (HTML) |
| `file.close` | File closed |

### App Events

| Event Name | Description |
|------------|-------------|
| `app.launch` | App started initializing |
| `app.ready` | App fully initialized |
| `app.quit` | App shutting down |
| `app.error` | App-level error occurred |

### Window Events

| Event Name | Description |
|------------|-------------|
| `window.open` | Window created |
| `window.close` | Window closed |
| `window.focus` | Window gained focus |
| `window.blur` | Window lost focus |
| `window.move` | Window moved/dragged |

### External File Open Events

| Event Name | Description |
|------------|-------------|
| `file.open.external` | File opened via Finder "Open With" or double-click |
| `file.open.drop` | File dropped onto app window |
| `file.open.cli` | File opened via command line arguments |
| `app.single_instance` | App received file from another instance |

### Tab/Document Events

| Event Name | Description |
|------------|-------------|
| `tab.open` | New document tab opened |
| `tab.close` | Document tab closed |
| `tab.switch` | User switched between tabs |

## Sample Log Entries

### App Launch Sequence

```jsonl
{"ts":"2026-01-28T10:00:00.000-08:00","level":"info","event":"app.launch","status":"start","actionId":"a1b2c3d4-...","context":{"appVersion":"0.1.5","platform":"darwin"}}
{"ts":"2026-01-28T10:00:01.234-08:00","level":"info","event":"app.ready","status":"success","actionId":"a1b2c3d4-...","durationMs":1234,"context":{"startupTimeMs":1234}}
```

### File Save via Toolbar

```jsonl
{"ts":"2026-01-28T10:05:00.000-08:00","level":"info","event":"ui.button.click","status":"success","actionId":"e5f6g7h8-...","context":{"screen":"editor","controlId":"toolbar.save","documentId":"doc-123"}}
{"ts":"2026-01-28T10:05:00.001-08:00","level":"info","event":"file.save","status":"start","actionId":"e5f6g7h8-...","context":{"filePath":"/Users/jack/notes.md","documentId":"doc-123"}}
{"ts":"2026-01-28T10:05:00.125-08:00","level":"info","event":"file.save","status":"success","actionId":"e5f6g7h8-...","durationMs":124,"context":{"filePath":"/Users/jack/notes.md","fileSizeBytes":2048}}
```

### Save Failure

```jsonl
{"ts":"2026-01-28T10:06:00.000-08:00","level":"info","event":"file.save","status":"start","actionId":"i9j0k1l2-...","context":{"filePath":"/readonly/file.md"}}
{"ts":"2026-01-28T10:06:00.050-08:00","level":"error","event":"file.save","status":"fail","actionId":"i9j0k1l2-...","durationMs":50,"error":"Permission denied: /readonly/file.md"}
```

### Finder "Open With" (External Open)

```jsonl
{"ts":"2026-01-28T10:07:00.000-08:00","level":"info","event":"file.open.external","status":"start","actionId":"m3n4o5p6-...","context":{"filePath":"/Users/jack/document.md","source":"finder"}}
{"ts":"2026-01-28T10:07:00.500-08:00","level":"info","event":"file.open.external","status":"success","actionId":"m3n4o5p6-...","durationMs":500,"context":{"filePath":"/Users/jack/document.md","fileSizeBytes":1024}}
```

### Single Instance (App Already Running)

```jsonl
{"ts":"2026-01-28T10:08:00.000-08:00","level":"info","event":"app.single_instance","status":"success","actionId":"q7r8s9t0-...","context":{"details":{"filePaths":["/Users/jack/another.md"],"source":"finder"}}}
{"ts":"2026-01-28T10:08:00.001-08:00","level":"info","event":"file.open.external","status":"start","actionId":"u1v2w3x4-...","context":{"filePath":"/Users/jack/another.md","source":"single_instance"}}
```

### Drag & Drop

```jsonl
{"ts":"2026-01-28T10:09:00.000-08:00","level":"info","event":"file.open.drop","status":"start","actionId":"y5z6a7b8-...","context":{"filePath":"/Users/jack/dropped.md","dropTarget":"window"}}
{"ts":"2026-01-28T10:09:00.300-08:00","level":"info","event":"file.open.drop","status":"success","actionId":"y5z6a7b8-...","durationMs":300,"context":{"filePath":"/Users/jack/dropped.md","fileSizeBytes":2048}}
```

### Tab Operations

```jsonl
{"ts":"2026-01-28T10:10:00.000-08:00","level":"info","event":"tab.open","status":"success","actionId":"c9d0e1f2-...","context":{"documentId":"doc-456","filePath":"/Users/jack/file2.md","tabIndex":1}}
{"ts":"2026-01-28T10:10:05.000-08:00","level":"info","event":"tab.switch","status":"success","actionId":"g3h4i5j6-...","context":{"fromDocumentId":"doc-123","toDocumentId":"doc-456"}}
{"ts":"2026-01-28T10:10:10.000-08:00","level":"info","event":"tab.close","status":"success","actionId":"k7l8m9n0-...","context":{"documentId":"doc-456","wasModified":false}}
```

## Validation Rules

1. **ts**: Must be valid ISO 8601 with timezone
2. **event**: Must follow namespace pattern `category.action` (e.g., `ui.button.click`)
3. **actionId**: Must be valid UUID v4
4. **level**: Must match configured minimum level to be written
5. **error**: Required when `status` is `fail`
6. **durationMs**: Required when `status` is `success` or `fail` (for timed operations)
