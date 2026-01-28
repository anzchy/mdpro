# Quickstart: Concrete Logging Implementation

**Feature**: 005-add-concrete-logging
**Date**: 2026-01-28

## Prerequisites

- mdpro codebase checked out on branch `005-add-concrete-logging`
- Rust toolchain installed
- Node.js/pnpm installed

## Implementation Order

Follow this sequence for minimal merge conflicts:

### Step 1: Backend Models (Rust)

Create `src-tauri/src/models/log_entry.rs`:

```rust
// Copy from data-model.md: LogEntry, LogLevel, LogStatus, LogContext structs
```

Update `src-tauri/src/models/mod.rs`:
```rust
mod log_entry;
pub use log_entry::*;
```

Update `src-tauri/src/models/preferences.rs`:
```rust
// Add LogSettings struct and field to UserPreferences
#[serde(default)]
pub logging: LogSettings,
```

### Step 2: Backend Logger Upgrade (Rust)

Update `src-tauri/src/services/logger.rs`:

```rust
use crate::models::{LogEntry, LogEntryPayload, LogLevel, LogStatus};
use chrono::Local;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

fn log_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home).join(".mdpro");
    if !dir.exists() {
        let _ = create_dir_all(&dir);
    }
    Some(dir.join("mdpro.log"))
}

// Keep existing for backward compatibility
pub fn log_line(message: &str) {
    // ... existing implementation ...
}

// New: Structured JSONL logging
pub fn log_structured_event(payload: LogEntryPayload) {
    // Check if logging is enabled
    let prefs = crate::services::preferences::load_preferences().unwrap_or_default();
    if !prefs.logging.enabled {
        return;
    }

    // Check level threshold
    if !should_log(&payload.level, &prefs.logging.level) {
        return;
    }

    let entry = LogEntry {
        ts: Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        level: payload.level,
        event: payload.event,
        status: payload.status,
        action_id: payload.action_id,
        context: payload.context,
        duration_ms: payload.duration_ms,
        error: payload.error,
    };

    let Some(path) = log_path() else { return };
    let Ok(json) = serde_json::to_string(&entry) else { return };

    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{}", json);
    }
}

fn should_log(event_level: &LogLevel, threshold: &LogLevel) -> bool {
    let level_order = |l: &LogLevel| match l {
        LogLevel::Debug => 0,
        LogLevel::Info => 1,
        LogLevel::Warn => 2,
        LogLevel::Error => 3,
    };
    level_order(event_level) >= level_order(threshold)
}
```

### Step 3: Backend Commands (Rust)

Create `src-tauri/src/commands/logging.rs`:

```rust
use crate::models::{LogEntryPayload, LogSettings};

#[tauri::command]
pub fn log_event(entry: LogEntryPayload) {
    crate::services::logger::log_structured_event(entry);
}

#[tauri::command]
pub fn get_logging_settings() -> LogSettings {
    crate::services::preferences::load_preferences()
        .map(|p| p.logging)
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_logging_settings(settings: LogSettings) -> Result<(), String> {
    let mut prefs = crate::services::preferences::load_preferences().unwrap_or_default();
    prefs.logging = settings;
    crate::services::preferences::save_preferences(&prefs).map_err(|e| e.to_string())
}
```

Update `src-tauri/src/commands/mod.rs`:
```rust
mod logging;

pub fn handlers() -> impl Fn(tauri::Invoke) {
    tauri::generate_handler![
        // ... existing handlers ...
        logging::log_event,
        logging::get_logging_settings,
        logging::set_logging_settings,
    ]
}
```

### Step 4: App Lifecycle Logging (Rust)

Update `src-tauri/src/main.rs`:

```rust
use tauri_app_lib::models::{LogEntryPayload, LogLevel, LogStatus, LogContext};
use tauri_app_lib::services::logger;

fn main() {
    let launch_action_id = uuid::Uuid::new_v4().to_string();
    let launch_start = std::time::Instant::now();

    // Log app.launch
    logger::log_structured_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "app.launch".to_string(),
        status: LogStatus::Start,
        action_id: launch_action_id.clone(),
        context: Some(LogContext {
            app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
            platform: Some(std::env::consts::OS.to_string()),
            ..Default::default()
        }),
        ..Default::default()
    });

    let app = tauri::Builder::default()
        .setup(|app| {
            // ... existing setup ...

            // Log app.ready
            logger::log_structured_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "app.ready".to_string(),
                status: LogStatus::Success,
                action_id: launch_action_id.clone(),
                duration_ms: Some(launch_start.elapsed().as_millis() as u64),
                context: Some(LogContext {
                    startup_time_ms: Some(launch_start.elapsed().as_millis() as u64),
                    ..Default::default()
                }),
                ..Default::default()
            });

            Ok(())
        })
        // ... rest of builder ...
}
```

### Step 5: Frontend Types (TypeScript)

Create `src/types/logging.ts`:

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
    fileSizeBytes?: number;
    encoding?: string;
    details?: Record<string, unknown>;
}

export interface LogEntryPayload {
    level: LogLevel;
    event: string;
    status: LogStatus;
    actionId: string;
    context?: LogContext;
    durationMs?: number;
    error?: string;
}

export interface LogSettings {
    enabled: boolean;
    level: LogLevel;
}
```

### Step 6: Frontend Logging Service (TypeScript)

Create `src/services/loggingService.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core';
import type { LogEntryPayload, LogSettings, LogLevel, LogStatus, LogContext } from '../types/logging';

export function generateActionId(): string {
    return crypto.randomUUID();
}

export async function logEvent(payload: LogEntryPayload): Promise<void> {
    try {
        await invoke('log_event', { entry: payload });
    } catch {
        // Silently ignore logging errors
    }
}

export function logEventSync(payload: LogEntryPayload): void {
    invoke('log_event', { entry: payload }).catch(() => {});
}

export async function getLoggingSettings(): Promise<LogSettings> {
    return invoke<LogSettings>('get_logging_settings');
}

export async function setLoggingSettings(settings: LogSettings): Promise<void> {
    await invoke('set_logging_settings', { settings });
}

// Convenience helpers
export function logUIEvent(
    event: string,
    controlId: string,
    screen: string,
    actionId?: string,
    details?: Record<string, unknown>
): void {
    logEventSync({
        level: 'info',
        event,
        status: 'success',
        actionId: actionId || generateActionId(),
        context: { screen, controlId, details },
    });
}

export function logMenuSelect(controlId: string, actionId?: string): void {
    logUIEvent('ui.menu.select', controlId, 'menu', actionId);
}

export function logShortcut(shortcut: string, actionId?: string): void {
    logEventSync({
        level: 'info',
        event: 'ui.shortcut.trigger',
        status: 'success',
        actionId: actionId || generateActionId(),
        context: { screen: 'editor', details: { shortcut } },
    });
}
```

### Step 7: Frontend Integration

Update `src/hooks/useMenuEvents.ts` to add logging:

```typescript
import { logMenuSelect, generateActionId } from '../services/loggingService';

// In menu event handler:
const handleMenuAction = (action: string) => {
    const actionId = generateActionId();
    logMenuSelect(`menu.${action}`, actionId);
    // ... existing handler logic ...
};
```

Update `src/hooks/useKeyboardShortcuts.ts`:

```typescript
import { logShortcut, generateActionId } from '../services/loggingService';

// In shortcut handler:
const handleShortcut = (shortcut: string) => {
    const actionId = generateActionId();
    logShortcut(shortcut, actionId);
    // ... existing handler logic ...
};
```

### Step 8: Settings UI

Add to Settings > General section:

```tsx
// In GeneralSettings component
const [loggingEnabled, setLoggingEnabled] = useState(true);
const [logLevel, setLogLevel] = useState<LogLevel>('info');

useEffect(() => {
    getLoggingSettings().then(settings => {
        setLoggingEnabled(settings.enabled);
        setLogLevel(settings.level);
    });
}, []);

const handleLoggingToggle = async (enabled: boolean) => {
    setLoggingEnabled(enabled);
    await setLoggingSettings({ enabled, level: logLevel });
};

const handleLevelChange = async (level: LogLevel) => {
    setLogLevel(level);
    await setLoggingSettings({ enabled: loggingEnabled, level });
};

// In render:
<Toggle
    label="Enable Logging"
    checked={loggingEnabled}
    onChange={handleLoggingToggle}
/>
<Select
    label="Log Level"
    value={logLevel}
    options={[
        { value: 'debug', label: 'Debug' },
        { value: 'info', label: 'Info' },
        { value: 'warn', label: 'Warning' },
        { value: 'error', label: 'Error' },
    ]}
    onChange={handleLevelChange}
/>
```

## Verification

After implementation, verify with:

```bash
# Watch log file
tail -f ~/.mdpro/mdpro.log | jq .

# Check log entries are valid JSON
cat ~/.mdpro/mdpro.log | jq -c . > /dev/null && echo "Valid JSONL"

# Filter by event type
cat ~/.mdpro/mdpro.log | jq 'select(.event == "file.save")'

# Filter by action ID
cat ~/.mdpro/mdpro.log | jq 'select(.actionId == "your-uuid-here")'
```

## Common Issues

1. **Logs not appearing**: Check `~/.mdpro/` directory exists and is writable
2. **Preferences not saving**: Ensure `preferences.json` has valid JSON
3. **Frontend logs failing silently**: Check browser console for invoke errors
