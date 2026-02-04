# IPC Contracts: Table Commands

**Feature**: Table Rendering and Editing (FR-015 to FR-017)
**Module**: Frontend-only (Milkdown plugin)

## Overview

Table editing is handled entirely in the frontend via the Milkdown editor's table plugin. No IPC commands are required as all operations manipulate the Prosemirror document state directly.

This contract documents the frontend interfaces and expected behaviors.

---

## Frontend Interfaces

### TableContextMenu Component

```typescript
// src/components/Editor/TableContextMenu.tsx

interface TableContextMenuProps {
  /** Position to render menu */
  position: { x: number; y: number };
  /** Current cell position */
  cell: { row: number; column: number };
  /** Callback when action is selected */
  onAction: (action: TableAction) => void;
  /** Callback to close menu */
  onClose: () => void;
}

type TableAction =
  | { type: 'insertRowAbove' }
  | { type: 'insertRowBelow' }
  | { type: 'insertColumnLeft' }
  | { type: 'insertColumnRight' }
  | { type: 'deleteRow' }
  | { type: 'deleteColumn' }
  | { type: 'alignLeft' }
  | { type: 'alignCenter' }
  | { type: 'alignRight' };
```

### Menu Structure

```typescript
const MENU_ITEMS: MenuItem[] = [
  { type: 'insertRowAbove', label: 'Insert Row Above', icon: 'row-above' },
  { type: 'insertRowBelow', label: 'Insert Row Below', icon: 'row-below', shortcut: '⌘⏎' },
  { type: 'separator' },
  { type: 'insertColumnLeft', label: 'Insert Column Left', icon: 'col-left' },
  { type: 'insertColumnRight', label: 'Insert Column Right', icon: 'col-right' },
  { type: 'separator' },
  { type: 'alignLeft', label: 'Align Left', icon: 'align-left' },
  { type: 'alignCenter', label: 'Align Center', icon: 'align-center' },
  { type: 'alignRight', label: 'Align Right', icon: 'align-right' },
  { type: 'separator' },
  { type: 'deleteRow', label: 'Delete Row', icon: 'trash', destructive: true },
  { type: 'deleteColumn', label: 'Delete Column', icon: 'trash', destructive: true },
];
```

---

## Milkdown Plugin Contract

### Table Plugin Extension

```typescript
// src/plugins/milkdown/tablePlugin.ts

import { tableCommands } from '@milkdown/preset-gfm';
import { Plugin, PluginKey } from '@milkdown/prose/state';

export const tableContextMenuPlugin = $prose(() => {
  const key = new PluginKey('table-context-menu');

  return new Plugin({
    key,
    props: {
      handleDOMEvents: {
        contextmenu: (view, event) => {
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!pos) return false;

          const $pos = view.state.doc.resolve(pos.pos);
          const cell = findTableCell($pos);

          if (cell) {
            event.preventDefault();
            showContextMenu({
              position: { x: event.clientX, y: event.clientY },
              cell: { row: cell.row, column: cell.column },
              view,
            });
            return true;
          }

          return false;
        },
      },
    },
  });
});
```

### Table Commands

```typescript
// Commands executed via Prosemirror transactions

interface TableCommands {
  /** Insert a row above the current cell */
  insertRowAbove(): void;

  /** Insert a row below the current cell */
  insertRowBelow(): void;

  /** Insert a column to the left of the current cell */
  insertColumnLeft(): void;

  /** Insert a column to the right of the current cell */
  insertColumnRight(): void;

  /** Delete the current row */
  deleteRow(): void;

  /** Delete the current column */
  deleteColumn(): void;

  /** Set column alignment */
  setColumnAlignment(alignment: 'left' | 'center' | 'right'): void;
}

// Implementation using Milkdown's table commands
export function executeTableAction(ctx: Ctx, action: TableAction): void {
  const commands = ctx.get(commandsCtx);

  switch (action.type) {
    case 'insertRowAbove':
      commands.call(insertRowAboveCommand.key);
      break;
    case 'insertRowBelow':
      commands.call(insertRowBelowCommand.key);
      break;
    case 'insertColumnLeft':
      commands.call(insertColumnLeftCommand.key);
      break;
    case 'insertColumnRight':
      commands.call(insertColumnRightCommand.key);
      break;
    case 'deleteRow':
      commands.call(deleteRowCommand.key);
      break;
    case 'deleteColumn':
      commands.call(deleteColumnCommand.key);
      break;
    case 'alignLeft':
      commands.call(setColumnAlignmentCommand.key, 'left');
      break;
    case 'alignCenter':
      commands.call(setColumnAlignmentCommand.key, 'center');
      break;
    case 'alignRight':
      commands.call(setColumnAlignmentCommand.key, 'right');
      break;
  }
}
```

---

## Keyboard Shortcuts

### Table Navigation

| Shortcut | Action |
|----------|--------|
| `Tab` | Move to next cell (create row if at end) |
| `Shift+Tab` | Move to previous cell |
| `⌘+Enter` | Insert row below current |
| `Enter` | New line within cell |
| `Escape` | Exit table editing |

### Implementation

```typescript
// Keyboard handler for table shortcuts
const tableKeymap = keymap({
  Tab: (state, dispatch) => {
    if (isInTable(state)) {
      return goToNextCell(state, dispatch, 1);
    }
    return false;
  },
  'Shift-Tab': (state, dispatch) => {
    if (isInTable(state)) {
      return goToNextCell(state, dispatch, -1);
    }
    return false;
  },
  'Mod-Enter': (state, dispatch) => {
    if (isInTable(state)) {
      return insertRowBelow(state, dispatch);
    }
    return false;
  },
});
```

---

## Alignment Persistence

Alignment is stored in Markdown using the GFM table syntax:

```markdown
| Left | Center | Right |
|:-----|:------:|------:|
| L    |   C    |     R |
```

### Alignment Detection

```typescript
function parseAlignment(separator: string): 'left' | 'center' | 'right' | null {
  const trimmed = separator.trim();

  if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
    return 'center';
  }
  if (trimmed.endsWith(':')) {
    return 'right';
  }
  if (trimmed.startsWith(':')) {
    return 'left';
  }
  return null; // Default (left)
}
```

### Alignment Serialization

```typescript
function serializeAlignment(alignment: 'left' | 'center' | 'right' | null): string {
  switch (alignment) {
    case 'left':
      return ':---';
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    default:
      return '---';
  }
}
```

---

## Column Resize (Optional Enhancement)

### CSS Styles

```css
/* Column resize handles */
.table-column-resize-handle {
  position: absolute;
  top: 0;
  right: -2px;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
}

.table-column-resize-handle:hover,
.table-column-resize-handle.dragging {
  background: var(--accent-color);
}
```

### Resize Handler

```typescript
function handleColumnResize(
  view: EditorView,
  columnIndex: number,
  deltaX: number
): void {
  const tr = view.state.tr;

  // Update column width attribute
  const table = findTable(view.state);
  if (table) {
    const newWidth = Math.max(50, currentWidth + deltaX);
    tr.setNodeAttribute(table.pos, 'columnWidths', {
      ...table.node.attrs.columnWidths,
      [columnIndex]: newWidth,
    });
    view.dispatch(tr);
  }
}
```

---

## Rendering in Different View Modes

### WYSIWYG Mode (Milkdown)

Tables render as interactive Prosemirror nodes with:
- Editable cells
- Context menu on right-click
- Keyboard navigation
- Column resize handles

### Preview Mode (marked)

Tables render as static HTML using `marked` with GFM tables enabled:

```typescript
marked.setOptions({
  gfm: true,
  tables: true,
});
```

### Split View

Both views render tables, with source view showing raw Markdown and preview showing rendered HTML.

---

## Performance Considerations

### Large Table Handling (100+ rows)

Per FR-004 (edge case): Implement virtual scrolling for large tables.

```typescript
// Use react-window or similar for virtualization
import { VariableSizeGrid } from 'react-window';

function VirtualizedTable({ rows, columns }: Props) {
  return (
    <VariableSizeGrid
      columnCount={columns.length}
      rowCount={rows.length}
      columnWidth={(index) => columnWidths[index]}
      rowHeight={() => ROW_HEIGHT}
    >
      {({ columnIndex, rowIndex, style }) => (
        <TableCell
          style={style}
          value={rows[rowIndex][columnIndex]}
        />
      )}
    </VariableSizeGrid>
  );
}
```
