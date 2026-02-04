# IPC Contracts: Tab Commands

**Feature**: Multi-Tab Document Support (FR-005 to FR-009)
**Module**: Frontend-only (Zustand store), with preferences sync

## Overview

Tab management is primarily handled in the frontend via Zustand store (`tabStore`). IPC commands are only needed for:
1. Persisting tab state to preferences
2. Loading restored tabs on app launch
3. Coordinating with document lifecycle

---

## Commands

### `get_tab_preferences`

Retrieves saved tab bar configuration and recent tabs.

**Direction**: Frontend → Backend

**Parameters**: None

**Returns**:

```typescript
interface GetTabPreferencesResult {
  config: TabBarConfig;
  recentTabs: RecentTabInfo[];
}

interface TabBarConfig {
  position: 'top' | 'bottom';
  maxVisibleTabs: number;
  showCloseOnHover: boolean;
  closeFocusBehavior: 'mru' | 'right' | 'left';
}

interface RecentTabInfo {
  /** Path to the document file */
  documentPath: string;
  /** Preserved state for restoration */
  state: TabState;
  /** Timestamp of last access */
  lastAccessedAt: number;
}

interface TabState {
  scrollTop: number;
  cursorPosition: { line: number; column: number };
  viewMode: 'split' | 'editor' | 'preview' | 'wysiwyg';
}
```

**Rust Signature**:

```rust
#[tauri::command]
pub async fn get_tab_preferences(
    state: State<'_, AppState>,
) -> Result<GetTabPreferencesResult, CommandError>
```

---

### `save_tab_preferences`

Saves tab bar configuration and recent tabs to preferences.

**Direction**: Frontend → Backend

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `config` | `TabBarConfig` | Yes | Tab bar configuration |
| `recent_tabs` | `RecentTabInfo[]` | Yes | Recent tabs for restoration |

**Returns**:

```typescript
interface SaveTabPreferencesResult {
  success: boolean;
}
```

**Rust Signature**:

```rust
#[tauri::command]
pub async fn save_tab_preferences(
    config: TabBarConfig,
    recent_tabs: Vec<RecentTabInfo>,
    state: State<'_, AppState>,
) -> Result<SaveTabPreferencesResult, CommandError>
```

---

### `restore_session_tabs`

Restores tabs from the previous session on app launch.

**Direction**: Frontend → Backend

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `max_tabs` | `number` | No | Maximum tabs to restore (default: 10) |

**Returns**:

```typescript
interface RestoreSessionTabsResult {
  tabs: RestoredTab[];
}

interface RestoredTab {
  documentPath: string;
  content: string;
  state: TabState;
  /** Whether file still exists on disk */
  fileExists: boolean;
}
```

**Errors**:

| Code | Description |
|------|-------------|
| `NO_SESSION` | No previous session to restore |
| `PARTIAL_RESTORE` | Some files could not be restored |

---

## Events

### `tab:close-requested`

Emitted when user attempts to close a tab with unsaved changes.

**Direction**: Frontend internal (no IPC)

**Payload**:

```typescript
interface TabCloseRequestedEvent {
  tabId: string;
  documentId: string;
  isDirty: boolean;
}
```

---

## Frontend Store Contract

### TabStore Actions

```typescript
// src/stores/tabStore.ts

interface TabStoreActions {
  /**
   * Opens a new tab for the given document.
   * If document is already open, switches to existing tab.
   * @returns The tab ID (new or existing)
   */
  openTab(documentId: string, title: string): string;

  /**
   * Closes a tab. Prompts for save if dirty.
   * @returns Promise that resolves when tab is closed (or user cancels)
   */
  closeTab(tabId: string): Promise<boolean>;

  /**
   * Switches to the specified tab.
   * Saves current tab state before switching.
   */
  switchToTab(tabId: string): void;

  /**
   * Marks a tab as dirty (has unsaved changes).
   */
  setTabDirty(tabId: string, isDirty: boolean): void;

  /**
   * Reorders tabs via drag-and-drop.
   */
  reorderTabs(fromIndex: number, toIndex: number): void;

  /**
   * Pins a tab (prevents auto-close, moves to left).
   */
  pinTab(tabId: string): void;

  /**
   * Unpins a tab.
   */
  unpinTab(tabId: string): void;

  /**
   * Restores the most recently closed tab.
   * @returns The restored tab, or null if no tabs to restore
   */
  undoCloseTab(): Tab | null;

  /**
   * Saves current scroll/cursor state for a tab.
   */
  saveTabState(tabId: string, state: Partial<TabState>): void;

  /**
   * Gets the next tab to focus after closing the active tab.
   * Implements MRU or adjacent tab logic based on settings.
   */
  getNextTabOnClose(closingTabId: string): string | null;
}
```

### Tab Lifecycle

```
User opens file
       │
       ▼
┌─────────────────────────────────────────────┐
│ Is file already open in a tab?              │
└─────────────────────────────────────────────┘
       │                    │
      Yes                   No
       │                    │
       ▼                    ▼
Switch to existing    Create new Tab
tab (update MRU)      Insert at end (or after active)
       │                    │
       └────────┬───────────┘
                │
                ▼
        Update activeTabId
        Save previous tab state
        Restore new tab state
```

### Close Tab Flow

```
User closes tab (Cmd+W, click X, middle-click)
       │
       ▼
┌─────────────────────────────────────────────┐
│ Is tab dirty?                               │
└─────────────────────────────────────────────┘
       │                    │
      Yes                   No
       │                    │
       ▼                    │
Show save dialog            │
       │                    │
   ┌───┴───┐                │
   │       │                │
 Save  Discard  Cancel      │
   │       │      │         │
   ▼       ▼      │         │
Save doc  Skip    │         │
   │       │      │         │
   └───┬───┘      │         │
       │          │         │
       ▼          │         │
Add to closedTabs ◄─────────┘
(max 10, LIFO)
       │
       ▼
Remove tab from tabs[]
       │
       ▼
Focus next tab (MRU or adjacent)
       │
       ▼
If no tabs left, close window
```

---

## Implementation Notes

### Tab Animation (CSS)

```css
/* Tab content transition - 300ms cross-fade, NO slide */
.tab-content {
  opacity: 0;
  transition: opacity 300ms ease-in-out;
}

.tab-content.active {
  opacity: 1;
}

/* Never use transform/translate for tab switching */
```

### Context Preservation

```typescript
// Before switching tabs
const currentState: TabState = {
  scrollTop: editorRef.current?.scrollTop ?? 0,
  cursorPosition: editor.getCursor(),
  viewMode: currentViewMode,
};
tabStore.saveTabState(activeTabId, currentState);

// After switching tabs
const newTabState = tabStore.getTab(newTabId)?.state;
if (newTabState) {
  editorRef.current?.scrollTo({ top: newTabState.scrollTop });
  editor.setCursor(newTabState.cursorPosition);
  setViewMode(newTabState.viewMode);
}
```

### Dirty State Indicator

```tsx
// Visual indicator in tab
<div className="tab-close-button">
  {tab.isDirty ? (
    <span className="dirty-indicator">●</span> // Filled circle
  ) : (
    <XIcon className="close-icon" /> // Standard X
  )}
</div>
```
