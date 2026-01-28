# Feature Specification: Concrete Logging (JSONL)

**Feature Branch**: `005-add-concrete-logging`
**Created**: 2026-01-28
**Status**: Draft
**Input**: User request: "添加丰富的Logging信息，包括open/write file, save file, 以及用户在app界面的每一个操作细节，用于监控app中操作是否成功完成"; log format JSONL; log path `~/.mdpro`; logging level and on/off switch in Settings > General (production default ON).

## Overview

This feature introduces structured, JSONL-based logging for UI interactions, backend file operations, and **app/window lifecycle events**. The goal is to audit every user action (buttons/menus/shortcuts), critical file lifecycle events (open/write/save), and system events (app launch, window open/close), recording start/success/failure with enough context to verify whether operations completed correctly.

Logs are written to a single JSONL file at `~/.mdpro/mdpro.log` (one JSON object per line). Logging can be enabled/disabled and filtered by level via **Settings > General**. Production builds default to logging ON at `info` level.

## Visual Design

- **Site Diagram**: [site-diagram.html](./diagrams/site-diagram.html) - 日志系统架构和数据流图

*Note: This feature adds minimal UI (only a settings toggle), so wireframe and user-flow diagrams are not required.*

## Goals

- Capture **all UI actions** (buttons, menus, keyboard shortcuts) with consistent, structured data.
- Capture **file operations** (open/write/save/export) with start/success/failure, including error details.
- Capture **app lifecycle events** (launch, ready, quit) and **window events** (open, close, focus).
- Use **JSONL** for easy parsing and offline analysis via command-line tools (jq, grep).
- Provide a **logging level** and **log switch** in Settings > General with production default ON.
- Preserve privacy: no file content is logged.

## Non-Goals

- Real-time remote telemetry or server upload.
- Full OS-level system logs integration.
- UI analytics dashboards (only local logs).
- Log rotation (out of scope for this phase).

## Log Storage

- **Primary Path**: `~/.mdpro/mdpro.log`
- **Format**: JSONL (UTF-8), one JSON object per line.
- **Rotation**: Out of scope for this phase. If log file exceeds reasonable size, user can manually delete it.

## Event Model

### Required Fields

```json
{
  "ts": "2026-01-28T12:34:56.789-08:00",
  "level": "info",
  "event": "ui.button.click",
  "status": "success",
  "actionId": "c48b2...",
  "context": {
    "screen": "editor",
    "controlId": "toolbar.save",
    "documentId": "doc-123",
    "filePath": "/Users/.../notes.md",
    "details": {"source": "toolbar"}
  },
  "durationMs": 125
}
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `ts` | string | ISO 8601 timestamp with timezone |
| `level` | enum | `debug`, `info`, `warn`, `error` |
| `event` | string | Namespaced event name (e.g., `ui.button.click`, `file.save`) |
| `status` | enum | `start`, `success`, `fail`, `cancel` |
| `actionId` | string | Correlation ID to link start/success/fail of the same action |
| `context` | object | Structured metadata (screen, controlId, filePath, documentId, etc.) |
| `durationMs` | number (optional) | Elapsed time for `success`/`fail` events |
| `error` | string (optional) | Error message for `fail` events |

### Logging Levels

| Level | Usage |
|-------|-------|
| `debug` | High-frequency UI events (disabled by default in production) |
| `info` | Normal UI actions and successful file operations |
| `warn` | Recoverable issues (e.g., file not found, canceled dialog) |
| `error` | Failures with errors (IO errors, permission issues, parse failures) |

## UI Logging Scope

### Coverage

- **All buttons** (toolbar, dialogs, sidebar, settings, context menus)
- **All menus** (app menu, context menu, settings navigation)
- **All shortcuts** (Cmd+S, Cmd+O, Cmd+N, etc.), including whether they triggered an action

### UI Event Naming

| Event Type | Event Name |
|------------|------------|
| Button click | `ui.button.click` |
| Menu selection | `ui.menu.select` |
| Shortcut trigger | `ui.shortcut.trigger` |
| Dialog confirm | `ui.dialog.confirm` |
| Dialog cancel | `ui.dialog.cancel` |
| Toggle/switch change | `ui.toggle.change` |
| Select/dropdown change | `ui.select.change` |
| Settings change | `ui.settings.change` |

### UI Context Requirements

| Field | Description | Required |
|-------|-------------|----------|
| `controlId` | Stable ID for the UI control (e.g., `toolbar.save`, `menu.file.open`) | Yes |
| `screen` | Logical screen/context (`editor`, `settings`, `sidebar`, `dialog.*`) | Yes |
| `documentId` | Current document ID | When applicable |
| `filePath` | File path | When relevant to action |
| `details` | Free-form JSON for action specifics | Optional |

## Backend (File Operations) Logging

### Required Operations

| Operation | Event Name | Description |
|-----------|------------|-------------|
| Open file | `file.open` | From file picker, path, or recent files |
| Write file | `file.write` | Internal writes, autosave |
| Save file | `file.save` | Explicit save (dialog or overwrite) |
| Export file | `file.export` | HTML export |
| Close file | `file.close` | Close document |

### Required Logging States

| Status | When |
|--------|------|
| `start` | Before action begins |
| `success` | On successful completion |
| `fail` | On error |
| `cancel` | On user cancellation (e.g., dialog closed) |

### File Operation Context

| Field | Description |
|-------|-------------|
| `filePath` | Full path to the file |
| `fileSizeBytes` | Size written/read (when known) |
| `encoding` | Character encoding (when detected) |
| `error` | Error message (when fail) |

## App & Window Lifecycle Logging

### App Lifecycle Events

| Event | Event Name | When Logged |
|-------|------------|-------------|
| App launch | `app.launch` | When Tauri app starts initializing |
| App ready | `app.ready` | When app is fully initialized and ready for user interaction |
| App quit | `app.quit` | When app is about to close (before cleanup) |
| App error | `app.error` | When a critical app-level error occurs |

### Window Lifecycle Events

| Event | Event Name | When Logged |
|-------|------------|-------------|
| Window open | `window.open` | When a new window is created |
| Window close | `window.close` | When a window is closed |
| Window focus | `window.focus` | When a window gains focus |
| Window blur | `window.blur` | When a window loses focus |
| Window move | `window.move` | When a window is moved/dragged |

### External File Open Events

| Event | Event Name | When Logged |
|-------|------------|-------------|
| Finder open | `file.open.external` | When file is opened via Finder "Open With" or double-click |
| Drag & drop | `file.open.drop` | When file is dropped onto the app window |
| Single instance | `app.single_instance` | When app receives file from another instance (app already running) |
| Command line | `file.open.cli` | When file is opened via command line arguments |

### Tab/Document Events

| Event | Event Name | When Logged |
|-------|------------|-------------|
| Tab open | `tab.open` | When a new document tab is opened |
| Tab close | `tab.close` | When a document tab is closed |
| Tab switch | `tab.switch` | When user switches between document tabs |

### App/Window Context

| Field | Description |
|-------|-------------|
| `windowId` | Unique identifier for the window |
| `windowLabel` | Tauri window label (e.g., "main", "settings") |
| `appVersion` | Current app version |
| `platform` | OS platform (e.g., "darwin") |
| `startupTimeMs` | Time from launch to ready (for `app.ready` event) |

## Logging Configuration (Settings > General)

The logging settings appear in **Settings > General** section:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Enable Logging | Toggle | ON | Master switch to enable/disable all logging |
| Log Level | Dropdown | `info` | Minimum level to record (`debug`, `info`, `warn`, `error`) |

**Behavior**:
- When logging is disabled, no log entries are written
- Changing log level takes effect immediately
- Settings are persisted in user preferences

## User Scenarios & Testing *(mandatory)*

### Story 1 - Save Document via Toolbar (P1)

As a developer debugging the app, when a user clicks the Save button, I want the action and outcome to be logged so I can confirm the save succeeded or diagnose why it failed.

**Why this priority**: Save is the most critical file operation; failures here cause data loss.

**Independent Test**: Can verify by clicking Save and checking `~/.mdpro/mdpro.log` for the corresponding entries.

**Acceptance Scenarios**:

1. **Given** a document has unsaved changes, **When** user clicks Save, **Then** logs contain:
   - `ui.button.click` with `controlId=toolbar.save`, `status=success`
   - `file.save` with `status=start` followed by `status=success`, same `actionId`
   - Both entries have matching `documentId` and `filePath`

2. **Given** saving fails due to permission error, **When** user clicks Save, **Then** logs contain:
   - `file.save` with `status=start`
   - `file.save` with `status=fail`, `error` field describing the permission issue

---

### Story 2 - Open File via Menu (P1)

As a developer, when a user selects File > Open or presses Cmd+O, I want the open dialog and outcome logged with status so I can trace file loading issues.

**Why this priority**: File open is equally critical; issues here prevent users from working.

**Independent Test**: Can verify by opening a file and checking logs for the sequence.

**Acceptance Scenarios**:

1. **Given** user selects File > Open, **When** dialog opens and file is selected, **Then** logs contain:
   - `ui.menu.select` with `controlId=menu.file.open`
   - `file.open` with `status=start` then `status=success`
   - Context includes `filePath` and `fileSizeBytes`

2. **Given** user opens file dialog then cancels, **When** user closes dialog, **Then** logs contain:
   - `ui.menu.select` with `controlId=menu.file.open`
   - `file.open` with `status=cancel`

---

### Story 3 - Keyboard Shortcut Logging (P1)

As a developer, I want all keyboard shortcuts logged with the action they triggered so I can trace user workflows.

**Why this priority**: Shortcuts are a primary interaction method; need visibility into these paths.

**Independent Test**: Press Cmd+S and verify both shortcut and file operation appear in logs.

**Acceptance Scenarios**:

1. **Given** user presses Cmd+S in editor, **When** save is executed, **Then** logs contain:
   - `ui.shortcut.trigger` with `details.shortcut="Cmd+S"`
   - `file.save` with `status=start` then `status=success`
   - Same `actionId` links the shortcut to the file operation

2. **Given** user presses Cmd+N, **When** new document is created, **Then** logs contain:
   - `ui.shortcut.trigger` with `details.shortcut="Cmd+N"`
   - Corresponding document creation event

---

### Story 4 - Toggle Logging On/Off (P2)

As a user, I want to enable or disable logging from Settings > General so I can control disk usage or privacy.

**Why this priority**: Important for user control, but not critical path for debugging.

**Independent Test**: Toggle logging off in settings, perform actions, verify no new log entries.

**Acceptance Scenarios**:

1. **Given** logging is enabled, **When** user toggles it OFF in Settings > General, **Then**:
   - `ui.toggle.change` is logged with `controlId=settings.general.logging.enabled`, `details.newValue=false`
   - Subsequent actions produce NO log entries

2. **Given** logging is disabled, **When** user toggles it ON, **Then**:
   - Subsequent actions ARE logged starting from the next action

---

### Story 5 - Change Log Level (P2)

As a developer, I want to change the minimum log level so I can get more or less detail as needed.

**Why this priority**: Useful for debugging but not essential for basic operation.

**Independent Test**: Set level to `error`, perform normal actions, verify only errors are logged.

**Acceptance Scenarios**:

1. **Given** log level is `info`, **When** user changes to `debug`, **Then**:
   - More granular events start appearing in logs
   - The level change itself is logged at `info` level

2. **Given** log level is `error`, **When** user performs a successful save, **Then**:
   - No `info`-level entries appear for that operation

---

### Story 6 - App Startup and Shutdown Logging (P1)

As a developer, I want app launch and shutdown events logged so I can diagnose startup failures and initialization issues.

**Why this priority**: Startup issues prevent users from using the app at all; critical for debugging build problems.

**Independent Test**: Launch app, check logs for `app.launch` and `app.ready` entries with startup timing.

**Acceptance Scenarios**:

1. **Given** app is launched, **When** initialization completes, **Then** logs contain:
   - `app.launch` with `status=start`, including `appVersion` and `platform`
   - `app.ready` with `status=success` and `startupTimeMs` showing total initialization time

2. **Given** app fails during startup, **When** initialization error occurs, **Then** logs contain:
   - `app.launch` with `status=start`
   - `app.error` with `status=fail` and `error` describing the failure

3. **Given** user quits the app, **When** app closes, **Then** logs contain:
   - `app.quit` with `status=success`

---

### Story 7 - Window Lifecycle Logging (P2)

As a developer, I want window open/close events logged so I can trace multi-window issues.

**Why this priority**: Useful for debugging window management, but secondary to core operations.

**Independent Test**: Open new window, close it, verify both events appear in logs.

**Acceptance Scenarios**:

1. **Given** user opens a new window (Cmd+N), **When** window appears, **Then** logs contain:
   - `window.open` with `windowId` and `windowLabel`

2. **Given** user closes a window (Cmd+W), **When** window closes, **Then** logs contain:
   - `window.close` with matching `windowId`

---

### Story 8 - Finder/External File Open (P1)

As a developer, I want to trace when files are opened via Finder "Open With" or double-click so I can diagnose external file association failures.

**Why this priority**: This is a known problem area; users report Finder open failures frequently.

**Independent Test**: Right-click a .md file in Finder, select "Open With" > mdpro, verify logs show `file.open.external`.

**Acceptance Scenarios**:

1. **Given** user right-clicks .md file in Finder, **When** selecting "Open With" > mdpro, **Then** logs contain:
   - `file.open.external` with `status=start`, `filePath`, and `source="finder"`
   - `file.open.external` with `status=success` or `status=fail`

2. **Given** user double-clicks .md file (mdpro is default), **When** file opens, **Then** logs contain:
   - `file.open.external` with same pattern as above

3. **Given** mdpro is already running, **When** user opens another file from Finder, **Then** logs contain:
   - `app.single_instance` with `filePaths` array
   - `file.open.external` for each file

---

### Story 9 - Drag & Drop File Open (P1)

As a developer, I want to trace when files are opened via drag & drop so I can diagnose drop failures.

**Why this priority**: This is another known problem area; drag & drop has failed before.

**Independent Test**: Drag a .md file onto the mdpro window, verify logs show `file.open.drop`.

**Acceptance Scenarios**:

1. **Given** mdpro is open with no document, **When** user drops .md file onto window, **Then** logs contain:
   - `file.open.drop` with `status=start`, `filePath`, `dropTarget="window"`
   - `file.open.drop` with `status=success` or `status=fail`

2. **Given** mdpro has a document open, **When** user drops another .md file, **Then** logs contain:
   - `file.open.drop` indicating whether new tab or new window was opened

3. **Given** user drops non-.md file, **When** drop is rejected, **Then** logs contain:
   - `file.open.drop` with `status=cancel`, `reason="unsupported_extension"`

---

### Story 10 - Multi-Tab Document Logging (P1)

As a developer, I want to trace tab open/close/switch operations so I can diagnose multi-document issues.

**Why this priority**: Multi-document handling is complex; need visibility into tab state changes.

**Independent Test**: Open multiple files, switch between tabs, close one, verify all operations logged.

**Acceptance Scenarios**:

1. **Given** user opens a new file, **When** new tab is created, **Then** logs contain:
   - `tab.open` with `documentId`, `filePath`, `tabIndex`

2. **Given** multiple tabs are open, **When** user clicks a different tab, **Then** logs contain:
   - `tab.switch` with `fromDocumentId`, `toDocumentId`

3. **Given** user closes a tab, **When** tab is closed, **Then** logs contain:
   - `tab.close` with `documentId`, `wasModified`

---

### Story 11 - Window Move/Drag Logging (P2)

As a developer, I want to trace window move operations so I can diagnose titlebar/dragging issues.

**Why this priority**: Lower priority but useful for debugging UI responsiveness issues.

**Independent Test**: Drag the window by its titlebar, verify logs show `window.move`.

**Acceptance Scenarios**:

1. **Given** user drags window titlebar, **When** window is repositioned, **Then** logs contain:
   - `window.move` with `windowId`, `fromPosition`, `toPosition`

---

### Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Log file doesn't exist | Create `~/.mdpro/mdpro.log` on first write |
| Log file is not writable (permissions) | Silently skip logging; do NOT crash or block user operations |
| Disk is full | Silently skip logging; app continues to function |
| `~/.mdpro` directory doesn't exist | Create directory before writing |
| Rapid consecutive actions (e.g., 10 clicks/second) | Log all events; no throttling (JSONL handles high volume) |
| App crashes mid-operation | Incomplete log entry is acceptable; `start` without `success`/`fail` indicates crash |
| Concurrent file operations | Each operation has unique `actionId`; logs may interleave but are traceable |
| Very long file path (>500 chars) | Log full path; no truncation |
| Non-ASCII characters in path | Log as UTF-8; no escaping issues |
| App crashes before `app.ready` | `app.launch` exists without `app.ready`; indicates startup crash |
| Log file locked by another process | Silently skip; app continues to function |
| Multiple windows open simultaneously | Each window has unique `windowId`; events are traceable |
| Finder open while app is running | `app.single_instance` logged before `file.open.external` |
| Drag multiple files at once | Each file gets separate `file.open.drop` entry |
| Drop non-markdown file | `file.open.drop` with `status=cancel` and reason |
| Rapid tab switching | Each switch logged without throttling |
| Tab close with unsaved changes | `tab.close` includes `wasModified=true` |
| Window drag/move rapidly | Only final position logged (debounced) |

## Requirements *(mandatory)*

### Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-001 | System MUST log all UI button clicks with `controlId` and `screen` |
| FR-002 | System MUST log all menu selections with `controlId` |
| FR-003 | System MUST log all keyboard shortcuts with the shortcut key combination |
| FR-004 | System MUST log file open/write/save/export/close operations with `start`/`success`/`fail`/`cancel` status |
| FR-005 | System MUST log app lifecycle events (launch, ready, quit, error) |
| FR-006 | System MUST log window lifecycle events (open, close, focus, blur, move) |
| FR-006a | System MUST log external file open events (Finder, drag-drop, CLI, single-instance) |
| FR-006b | System MUST log tab/document events (open, close, switch) |
| FR-007 | Logs MUST be formatted as JSONL (one JSON object per line, UTF-8) |
| FR-008 | Logs MUST be written to `~/.mdpro/mdpro.log` |
| FR-009 | System MUST provide a toggle to enable/disable logging in Settings > General |
| FR-010 | System MUST provide a dropdown to select minimum log level in Settings > General |
| FR-011 | Production builds MUST default to logging enabled at `info` level |
| FR-012 | Logs MUST NOT include file contents (only metadata) |
| FR-013 | Each action MUST have a unique `actionId` to correlate `start`/`success`/`fail` events |
| FR-014 | Failed log writes MUST NOT crash the app or block user operations |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-001 | Logging MUST NOT add perceptible latency to user operations (<50ms overhead) |
| NFR-002 | Logging MUST be resilient; write failures are silently ignored |
| NFR-003 | Log file MUST be human-readable (pretty JSON not required, but valid JSON) |

### Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| LogEntry | A single log record | ts, level, event, status, actionId, context |
| LogSettings | User's logging preferences | enabled (boolean), level (enum) |
| ActionContext | Metadata for an action | screen, controlId, documentId, filePath, details |

## Success Criteria *(mandatory)*

### Measurable Outcomes

| ID | Criterion | Measurement |
|----|-----------|-------------|
| SC-001 | All UI button clicks produce corresponding log entries | Manual test: click 10 different buttons, verify 10 log entries |
| SC-002 | All file operations (open/save/write) are logged with start+outcome | Manual test: open, edit, save file; verify 6+ entries (2 per operation) |
| SC-003 | Developer can identify operation failures within 5 minutes using logs | Simulate a save failure; time how long to locate the error in logs |
| SC-004 | Logging overhead is imperceptible to users | Log 100 rapid clicks; measure no UI freeze or stutter |
| SC-005 | Disabling logging stops all log writes | Toggle off, perform 10 actions, verify no new entries |
| SC-006 | Log entries are parseable by standard JSON tools | Run `jq` on log file; all entries parse successfully |
| SC-007 | App startup produces launch+ready log entries | Start app, verify `app.launch` and `app.ready` events with timing |
| SC-008 | Developers can trace startup failures using logs | Simulate startup error; verify error details in `app.error` entry |
| SC-009 | Finder "Open With" produces log entries | Right-click .md in Finder, open with mdpro, verify `file.open.external` |
| SC-010 | Drag & drop produces log entries | Drop .md file on window, verify `file.open.drop` |
| SC-011 | Tab operations are traceable | Open 3 files, switch tabs, close one; verify `tab.open/switch/close` |
| SC-012 | External open failures are diagnosable | Simulate Finder open failure; verify error details in logs |

## Assumptions

- Full file paths are logged (not hashed/redacted) since this is for local debugging only
- Debug-level logging is available but defaults to `info` in production; users can enable `debug` manually
- No log rotation in this phase; users manage file size manually if needed
- Log writes are asynchronous to avoid blocking UI thread
- The `~/.mdpro` directory is the standard app data location on macOS
