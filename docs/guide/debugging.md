# Debugging Strategies

Developer guide for debugging mdpro (moved from `CLAUDE.md`). Log format and
event naming live in `CLAUDE.md` § "Logging Rules" and
`.claude/rules/20-logging-and-docs.md`.

## Tauri Dev WebView DevTools

**In `pnpm tauri dev`, right-click anywhere in the window → "Inspect Element"** to open WebView DevTools with full Chrome DevTools capabilities:

- Elements / DOM inspection

- Console logs

- Network requests

- Sources with breakpoints

- Performance profiling

This is often overlooked but provides the best of both worlds: full DevTools + Tauri APIs.

## Enable DevTools in Production Builds (for internal testing)

Add to `tauri.conf.json` for test builds:

```json
{
  "app": {
    "windows": [{
      "devtools": true
    }]
  }
}
```

Or trigger via keyboard shortcut (add to Rust backend):

```rust
#[tauri::command]
fn toggle_devtools(window: tauri::Window) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}
```

**Note**: Disable DevTools in public releases for security.

## When to use `pnpm dev` (localhost:1420)

Use browser-based debugging for **frontend-only issues**:

- **React/UI bugs**: Component rendering, state management, CSS issues

- **Editor issues**: Milkdown/CodeMirror initialization, schema errors, plugin conflicts

- **Console errors**: JavaScript exceptions, React warnings, unhandled promises

- **Network inspection**: API calls, timing issues (DevTools Network tab)

- **DOM inspection**: Element structure, computed styles, event listeners

- **Hot reload**: Faster iteration when making frequent UI changes

**Advantages**: Chrome DevTools, breakpoints, React DevTools extension, instant feedback

**Limitations**: No Tauri APIs (file dialogs, native menus, window management)

## When to use `pnpm tauri dev` + JSONL logs

Use Tauri + log files for **integration and Tauri-specific issues**:

- **File operations**: Open, save, encoding detection, file watcher

- **IPC debugging**: Frontend ↔ Rust communication, invoke/event flow

- **Native features**: Menu events, window lifecycle, drag-drop from Finder

- **App startup**: Launch paths, single-instance handling, preferences loading

- **Production simulation**: Testing behavior closer to the built app

- **Race conditions**: Async timing issues between Tauri and React

**Commands**:

```bash
# Watch logs in real-time
tail -f ~/.mdpro/mdpro.log | jq .

# Filter by event type
tail -f ~/.mdpro/mdpro.log | jq 'select(.event | startswith("file."))'

# Filter by level
tail -f ~/.mdpro/mdpro.log | jq 'select(.level == "error")'
```

## Debug Workflow

1. **Start with localhost** if unsure - faster iteration, better tooling

2. **Switch to Tauri dev** when:

   - Issue only reproduces in Tauri window

   - Need to test file/menu/window operations

   - Debugging IPC or Rust backend

3. **Use both simultaneously**: localhost for UI, logs for backend correlation
