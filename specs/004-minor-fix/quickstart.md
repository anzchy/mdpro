# Quickstart: Multi-Window Support & UI Improvements

**Feature**: 004-minor-fix
**Date**: 2026-01-25

## Prerequisites

- macOS 13+ (Ventura or later)
- Node.js 18+ with pnpm
- Rust toolchain (1.75+)
- Xcode Command Line Tools

## Setup

```bash
# Clone and checkout feature branch
git checkout 004-minor-fix

# Install dependencies
pnpm install

# Start development
pnpm tauri dev
```

## Feature Implementation Order

### Phase 1: Multi-Window Foundation (P1)

1. **Backend Window Commands** (`src-tauri/src/commands/window.rs`)
   - `create_window` command using `WebviewWindowBuilder`
   - Window ID generation with UUID

2. **Frontend Window Service** (`src/services/windowService.ts`)
   - IPC wrapper for `create_window`
   - Type definitions

3. **Menu Event Handling** (`src/hooks/useMenuEvents.ts`)
   - Handle `file.new_window` action → call `windowService.createWindow()`

### Phase 2: Save Functionality (P1)

4. **Verify ⌘S Works**
   - `menu:action` with `file.save` already handled in `useMenuEvents.ts`
   - `save_file` command exists in `src-tauri/src/commands/file.rs`
   - Verify save dialog appears for untitled documents

### Phase 3: External File Opening (P2)

5. **Modify Launch Behavior** (`src-tauri/src/main.rs`)
   - In `RunEvent::Opened`, check if windows have documents
   - If yes, create new window for incoming files
   - If no, use existing window

6. **Update Single-Instance Handler** (`src-tauri/src/main.rs`)
   - Same logic for `tauri_plugin_single_instance` callback

### Phase 4: Window State Persistence (Clarification)

7. **Data Model Updates**
   - Add `WindowGeometry` struct
   - Add `window_states: HashMap` to preferences

8. **Backend Commands**
   - `save_window_geometry`
   - `get_window_geometry`

9. **Frontend Integration**
   - Save geometry on window close
   - Restore geometry on window open

### Phase 5: Settings Improvements (P2)

10. **Default View Mode Setting**
    - Add dropdown to Settings > General
    - Wire up to `set_preferences` command

11. **Settings Theme Fix**
    - Add `resolvedTheme` to `SettingsDialog`
    - Update CSS with theme variables

## Testing Checklist

### Manual Tests

- [ ] ⌘⇧N creates new empty window
- [ ] Original window unchanged after ⌘⇧N
- [ ] ⌘S saves existing file to disk
- [ ] ⌘S on untitled shows save dialog
- [ ] Window draggable by title bar
- [ ] Double-click .md in Finder opens new window (when app has doc)
- [ ] Settings page readable in light mode
- [ ] Settings page readable in dark mode
- [ ] Default View Mode dropdown works
- [ ] New documents use selected default view mode
- [ ] Window position restored for previously opened file

### Automated Tests

```bash
# Run frontend tests
pnpm test

# Run backend tests
cd src-tauri && cargo test
```

## Key Files Reference

| Purpose | File |
|---------|------|
| Window creation | `src-tauri/src/commands/window.rs` (new) |
| External file routing | `src-tauri/src/main.rs` |
| Menu handling | `src-tauri/src/menu.rs` |
| Frontend window service | `src/services/windowService.ts` (new) |
| Menu event handler | `src/hooks/useMenuEvents.ts` |
| Settings UI | `src/components/common/SettingsDialog.tsx` |
| Settings styles | `src/styles/settings.css` (new or existing) |
| Preferences model | `src-tauri/src/models/preferences.rs` |
| Preferences types | `src/types/preferences.ts` |

## Common Issues

### Window doesn't appear after ⌘⇧N
- Check console for Tauri errors
- Verify `create_window` command is registered in `handlers()`

### External file opens in wrong window
- Debug `RunEvent::Opened` handler
- Check `LaunchState` isn't capturing paths meant for new windows

### Settings theme not updating
- Verify `useThemeStore` is imported in `SettingsDialog`
- Check CSS class is applied: `theme-light` or `theme-dark`

## Architecture Notes

### Multi-Window Isolation
Each Tauri window loads the same `index.html` but creates:
- Independent React app instance
- Independent Zustand stores
- Separate document state

Windows communicate via:
- Tauri events (backend → all windows)
- Targeted events (backend → specific window)
- Shared preferences file (persisted state)

### Window Identification
- Each window gets unique ID: `mdpro-{uuid}`
- Window label used for targeting events
- File path used as key for geometry persistence
