# Plan: Table CRUD — context menu, Tab nav, alignment, column resize, source-mode parity

Generated: 2026-05-02
Branch: master
Repo: anzchy/mdpro
Tracking issue: [#390](https://github.com/anzchy/mdpro/issues/390)
Status: PHASE 1 SHIPPED 2026-05-03 (7 commits, c7bbec1..2b88a66). REVIEWED 2026-05-02 (`/plan-eng-review` Claude + Codex; `/plan-design-review` 7 passes).
Reference: vmark ([xiaolai/vmark](https://github.com/xiaolai/vmark))

## Problem Statement

mdpro relies on Milkdown's `gfm` preset for table parsing and rendering, but exposes **no table editing UX** — no insert command, no row/column add/delete, no alignment toggle, no column resize, no Tab navigation, and zero source-mode awareness. Users either type pipes by hand or paste rendered HTML, both hostile to keyboard-first editing.

Goal: bring mdpro's table editing to parity with Typora and vmark via a phased rollout, reusing the same plugin layout, logging, and testing patterns established by the recent image-resize feature (#389).

## Current State (commit `c306e4b`)

| Surface | Status |
|---|---|
| WYSIWYG render | ✓ via `gfm` preset (`MilkdownEditor.tsx:158`) |
| WYSIWYG insert command | ✗ no UI, ProseMirror commands not wired |
| WYSIWYG row/col add/delete | ✗ no menu, no shortcut |
| WYSIWYG alignment toggle | ✗ |
| WYSIWYG Tab navigation | ✗ Tab inserts a tab character |
| WYSIWYG cell highlight | ✗ no CSS for `.selectedCell` |
| WYSIWYG column resize | ✗ `columnResizing()` plugin not registered |
| Source mode awareness | ✗ no detection, no Tab nav, no context menu |
| Native menu | ✗ no Table submenu (`src-tauri/src/menu.rs`) |
| Keyboard defaults | ✗ no entries in `src/types/preferences.ts` |
| Shortcut docs | ✗ no entries in `docs/guide/keyboard-shortcuts.md` |
| MCP table tools | ✗ shadow store has document-level only |
| Lint rule | ✗ no column-count validation |
| CSS | Minimal (`MilkdownEditor.css:115-132`) — borders, header bg only |

## What's Already Available

Verified against `node_modules/.pnpm/@milkdown+preset-gfm@7.18.0/.../lib/index.js` and the running editor:

**Already active when `.use(gfm)` is called** (do not re-register):
- `columnResizingPlugin` — `columnResizing({})` is wired by default. To customize handle width / min cell width requires plugin replacement, not a plain `.use()`.
- `tableEditingPlugin` — `tableEditing({ allowTableNodeSelection: true })`.
- `keepTableAlignPlugin` — preserves `:--` / `:-:` / `--:` markers across edits.
- `autoInsertSpanPlugin` — auto-inserts `<span>` wrappers for cell content.

**Milkdown `$Command` wrappers** (use these, not raw `prosemirror-tables`):
- `insertTableCommand({ row, col })`
- `addRowBeforeCommand` / `addRowAfterCommand` / `addColBeforeCommand` / `addColAfterCommand`
- `setAlignCommand("left" | "center" | "right")` ← public alignment API; do **not** use raw `setCellAttr`
- `selectRowCommand({ index, pos })` / `selectColCommand({ index, pos })` / `selectTableCommand`
- `deleteSelectedCellsCommand` ← compose with `selectRow/Col` for row/column delete
- `moveRowCommand` / `moveColCommand` — bonus, no plan cost
- `goToNextTableCellCommand` / `goToPrevTableCellCommand` / `exitTable`

**Existing wiring patterns** (reuse, do not reinvent):
- `paragraphTable` shortcut already exists — `src/types/preferences.ts:114, 180` (default `Cmd+Option+T`); `src-tauri/src/models/preferences.rs:150`; surfaced in `KeyboardShortcutsSettings.tsx:60`. **It's wired to nothing today** (one of the "ghost shortcuts" flagged in `TODOS.md:13`). This plan completes it.
- `linkInsertStore` (`src/stores/linkInsertStore.ts`) — pattern for app-level shortcut → React modal → Milkdown editor instance bridge. The new `tableInsertStore` mirrors it.
- `LinkInsertModal` (`src/components/Editor/LinkInsertModal.tsx`) — focus-trap + form-submit pattern.
- `ImageContextMenu.css` and `ImageContextMenu.tsx` (shipped in #389) define the visual style and event-handler shape.
- `loggingService.logEventSync` and structured logging (`.claude/rules/20-logging-and-docs.md`).
- Three-file shortcut sync rule (`.claude/rules/41-keyboard-shortcuts.md`).

**NOT usable as written:**
- `pluginRegistry.getMilkdownPlugins()` (`src/plugins/core/pluginRegistry.ts:287`) is dead code — `MilkdownEditor.tsx:151` chains `.use(...)` manually and never calls the registry. New Milkdown plugins must be added directly to that chain. (Migrating to the registry path is **out of scope** here.)
- `prosemirror-tables` and `@codemirror/lint` are NOT in `package.json` direct deps — only transitive. Direct imports may break under strict pnpm hoisting. Use `@milkdown/prose/tables` (already a Milkdown surface) for ProseMirror table primitives; declare `@codemirror/lint` explicitly when Phase 3 lint lands.

## Constraints

- **No new heavy deps.** `prosemirror-tables` is already transitive.
- **Persist alignment in standard GFM syntax** (`:--` / `:-:` / `--:`). Do **not** invent custom title markers — that approach was a one-off for image resize, justified by GFM image syntax having no width attr. GFM tables already have alignment syntax.
- **300-line file rule** (`.claude/rules/00-engineering-principles.md` + `50-codebase-conventions.md`). Split per-action handlers if a plugin file grows past the limit.
- **Zustand**: `useXStore.getState()` in callbacks; no top-level destructuring.
- **Phases are independently land-able.** Each phase must compile, pass tests, and not regress prior phases.
- Column widths set via `colwidth` attr (Phase 2) **do not round-trip** through GFM markdown — explicitly document this as session-local in Settings/help. Don't silently surprise users.

## Design Specifications (Phase 1)

Captured during `/plan-design-review` 2026-05-02 (no DESIGN.md exists; universal principles + existing tokens applied; design language extends `ImageContextMenu` from #389).

### Insert Table modal — `TableInsertModal/`

```
┌────────────────────────────┐
│  Insert Table   ⌘⌥T        │  ← title 14px 600 var(--color-text); shortcut hint var(--color-muted) 12px right-aligned
│                            │
│  ┌──┬──┬──┬──┬──┬──┐      │  ← 10×10 hover grid; default 3×3 highlighted in var(--color-accent-soft) fallback color-mix
│  │  │  │  │  │  │  │      │     cell 22×22, 1px var(--color-border), border-radius 2px
│  ├──┼──┼──┼──┼──┼──┤      │     hover lights up the rect from top-left → cursor with var(--color-accent) bg
│  │  │  │  │  │  │  │      │
│  └──┴──┴──┴──┴──┴──┘      │
│       3 × 4 (header + 2 body rows × 4 cols)  ← live count, var(--color-muted), 12px, aria-live="polite"
│                            │
│  ── or specify ──          │  ← separator label, 12px var(--color-muted)
│  Rows [  3  ]   Cols [  4  ]  ← numeric inputs, 1-50 each, 32px tall, focus first
│                            │
│  [ Cancel ]   [ Insert ]   │  ← cancel left, primary action right
└────────────────────────────┘
```

- **Primary input**: hover grid (Notion / Typora pattern). Numeric below for >10.
- **First focus on open**: numeric `Rows` input (so power users can type past the default).
- **Submit**: Enter from any input, click Insert button.
- **Cancel**: Esc, click outside, click Cancel.
- **Reuse**: `LinkInsertModal` focus-trap and dismiss model.
- **a11y**: `role="dialog"`, `aria-labelledby` → title, `aria-describedby` → live count, `aria-modal="true"`.
- **Semantics**: `rows = N` means N body rows; the resulting table has 1 header + N body rows. Make this explicit in the live count text.

### TableContextMenu — structured layout

15 actions sectioned into 4 groups with separators:

```
┌─ Insert ─────────────────┐  ← group label: 11px 600 uppercase, letter-spacing 0.04em, var(--color-muted)
├ Insert row above
├ Insert row below
├ Insert column left
├ Insert column right
├──────────────────────────┤  ← <hr> 1px var(--color-border), margin: 4px 0
┌─ Move ───────────────────┐
├ Move row up         [↑]    ← right-aligned hint, 11px var(--color-muted), faded when disabled
├ Move row down       [↓]
├ Move column left    [←]
├ Move column right   [→]
├──────────────────────────┤
┌─ Alignment ──────────────┐
├ Align left          [✓]    ← is-active marker for current alignment
├ Align center
├ Align right
├ Clear alignment
├──────────────────────────┤  ← extra 8px margin above destructive group
┌─ Destructive ────────────┐
├ Delete row                  ← color: var(--color-danger); on hover: bg var(--color-danger), color var(--color-panel)
├ Delete column
└ Delete table             ┘
```

- **Hover preview** (Pass-3 fix): hovering an Alignment item shades the affected column with `var(--color-accent-soft)` outline, so the user sees scope before clicking.
- **Disabled state**: `Move row up` is disabled when on first row, etc. — opacity 0.4, `aria-disabled="true"`, no hover effect.
- **Reuses** `ImageContextMenu` button shape (`.image-context-menu-button`) — rename the prefix to `.editor-context-menu-button` in a follow-up TODO so the two menus share class selectors cleanly.

### Selected-cell visual

`prosemirror-tables` emits `selectedCell` decorations. CSS:

```css
.milkdown-editor .ProseMirror td.selectedCell,
.milkdown-editor .ProseMirror th.selectedCell {
  background: var(--color-accent-soft, color-mix(in srgb, var(--color-accent) 20%, transparent));
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}
```

For multi-cell drag selection (D5): apply outline only to outer-edge cells (`:first-child`, `:last-child` of the selection range) and fill inner cells with `--color-accent-soft` only — single bounding box, no per-cell outline pile-up.

### Column resize handle (Phase 2)

D4 resolved: always-visible hairline + accent-on-hover.

```css
.milkdown-editor .ProseMirror .column-resize-handle {
  position: absolute;
  right: -1px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-border);  /* always visible */
  pointer-events: auto;
  cursor: col-resize;
}
.milkdown-editor .ProseMirror td:hover .column-resize-handle,
.milkdown-editor .ProseMirror th:hover .column-resize-handle,
.milkdown-editor .ProseMirror .column-resize-handle.dragging {
  width: 3px;
  background: var(--color-accent);
}
```

Hit area: 8px wide invisible padding (handle has `padding-inline: 4px` so the 1px-wide handle catches a 9px hit zone).

### Visible alignment (WI-1.5 spec)

- `MilkdownEditor.css:122` — replace blanket `text-align: left` with:
  ```css
  .milkdown-editor .ProseMirror th,
  .milkdown-editor .ProseMirror td { text-align: left; }
  .milkdown-editor .ProseMirror th[data-text-align="center"],
  .milkdown-editor .ProseMirror td[data-text-align="center"] { text-align: center; }
  .milkdown-editor .ProseMirror th[data-text-align="right"],
  .milkdown-editor .ProseMirror td[data-text-align="right"] { text-align: right; }
  ```
  (Verify the attribute name `prosemirror-tables` actually emits — likely `align` or via a `setCellAttr("alignment", …)` that produces a node attr; the CSS selector must match.)
- `preview.css:55` — same 3-rule pattern.
- `html_template.rs:24` — same 3-rule pattern in the export template's CSS.

### Discoverability — toolbar button (D2)

- **Add an "Insert Table" icon button to `UniversalToolbar.tsx`** (Phase 1 scope; verify file exists). Position: next to the existing inline-formatting buttons. Icon: 16×16 grid (4 cells visible), simple line drawing matching the toolbar's existing icon style.
- **Tooltip**: `"Insert Table  ⌘⌥T"` — surfaces the shortcut.
- **Click**: opens the same `TableInsertModal` via `tableInsertStore.requestInsert(...)`.

### New design tokens to define

- `--color-accent-soft`: `color-mix(in srgb, var(--color-accent) 20%, transparent)` in both `light.css` and `dark.css`. (Or define `#dbeafe` for light, derive for dark.)
- `--color-danger`: `#dc2626` for light, `#f87171` for dark. Used by the Destructive group.

### Cursor placement after insert

After `runInsertTable(view, rows, cols)` completes, set ProseMirror selection to the **first header cell** (not body). Most users want to type column names first.

### Error UX for `runInsertTable` failure

When cursor is inside an existing table and `runInsertTable` returns false:
- Inline error row in the modal, above the buttons:
  ```
  ⚠ Cursor is inside another table — close this dialog,
    click outside the existing table, then try again.
  ```
- Color: `var(--color-danger)`, 12px, `role="alert"`.
- Modal does NOT auto-close; user clicks Cancel or fixes the cursor.

### Stale-position guard UX

When the document changes between menu open and click (covered by the try/catch in `useTableActions`), the menu silently closes today. Add: a brief toast `"Table no longer available — try again"` via the existing logging service (or skip if no toast infra exists in this app — verify and TODO if absent).

## Phase 1 — Minimum Viable Table Editing (P1)

### Scope

Insert (via existing `paragraphTable` shortcut) · context menu · Tab nav · visible alignment persisted as GFM · current-cell highlight.

### Directory layout (set up day one — keeps every file <300 LOC)

```
src/
├── stores/
│   └── tableInsertStore.ts                 # NEW — mirrors linkInsertStore
├── components/Editor/
│   ├── TableInsertModal/
│   │   ├── index.tsx                       # NEW — modal shell + focus trap
│   │   └── GridPicker.tsx                  # NEW — rows × cols visual picker
│   └── TableContextMenu/
│       ├── index.tsx                       # NEW — contextmenu listener + render
│       ├── ActionList.tsx                  # NEW — renders action descriptors
│       └── useTableActions.ts              # NEW — wires descriptors → Milkdown
└── plugins/milkdown/table/
    ├── actionDescriptors.ts                # NEW — shared {id, label, dispatch}
    ├── insertTable.ts                      # NEW — runInsertTable(rows, body)
    ├── contextMenu.ts                      # NEW — getActions(view, pos)
    └── types.ts                            # NEW — Action, MenuPosition, etc.
```

`actionDescriptors.ts` is consumed by both Phase 1 (WYSIWYG menu) and Phase 2 (source menu) — single source of truth for action labels, ids, and ordering.

### Work items

#### WI-0 (NEW) — Wire `paragraphTable` shortcut + tableInsertStore
**Why this is WI-0**: `paragraphTable` already exists in preferences (TS + Rust + Settings UI) but is wired to nothing — a "ghost shortcut" flagged in `TODOS.md:13`. Inventing a parallel `editorInsertTable` would create duplicate UI rows and conflict resolution. Completing the existing shortcut closes the TODO and unblocks WI-1.1.

- **New** `src/stores/tableInsertStore.ts` — Zustand store mirroring `linkInsertStore`:
  - `pendingDimensions: { rows, cols } | null`
  - `requestInsert(callback: (rows, cols) => void)` — opens modal, stores callback
  - `clearPending()` — closes modal
- **Edit** `src/hooks/useKeyboardShortcuts.ts` — when `paragraphTable` shortcut fires AND view mode is WYSIWYG, call `tableInsertStore.requestInsert(...)`. (Source mode: write GFM table syntax at cursor — separate Phase 2 path.)
- **Edit** `src/App.tsx` — pass the editor-insert callback to `useKeyboardShortcuts`.
- **TODOS.md** — close the `paragraphTable` ghost-shortcut item; reference this plan.
- **Tests** (`tests/tableInsertStore.test.ts`): `requestInsert` sets pending; callback fires on resolve; `clearPending` resets state.

#### WI-1.1 Insert Table modal + Milkdown wiring
- **New** `src/components/Editor/TableInsertModal/index.tsx` — opens when `tableInsertStore.pendingDimensions !== null`. Reuses `LinkInsertModal`'s focus-trap and Esc-to-cancel pattern.
- **New** `src/components/Editor/TableInsertModal/GridPicker.tsx` — rows × cols hover grid (max 10×10) plus numeric inputs (1-50 each). Submit with Enter.
- **New** `src/plugins/milkdown/table/insertTable.ts` — `runInsertTable(view, rows, cols)` dispatches `insertTableCommand({ row: rows, col: cols })`. **Semantics**: `rows` = number of *body* rows; the resulting GFM table has `rows + 1` total rows (header is always added).
- **Edit** `src/components/Editor/MilkdownEditor.tsx` — add `<TableInsertModal />` next to `<LinkInsertModal />`; the modal's submit handler closes over the Milkdown `editor` instance so it can dispatch the command. **Do NOT register a plugin in `src/plugins/index.ts`** — that registry path is dead code from `MilkdownEditor.tsx`'s perspective.
- **Tests** (`tests/milkdown-table-insert.test.ts`):
  - `runInsertTable` rejects rows<1, cols<1, rows>50, cols>50
  - `runInsertTable(view, 3, 4)` produces GFM with header + 3 body rows + 4 columns
  - **CRITICAL** `runInsertTable` returns false when cursor is in an invalid position (inside an existing table) — caller must surface this to the user, not silently no-op
  - Modal state transitions via `tableInsertStore`
  - (Modal keyboard nav follows the existing `link-insert-modal.test.ts` state-only pattern; full DOM keyboard tests are deferred until React Testing Library is added — separate TODO.)

#### WI-1.2 Native menu + shortcut sync
- **Edit** `src-tauri/src/menu.rs` — add `Format → Insert Table` with accelerator `CmdOrCtrl+Alt+T` (matching the existing `paragraphTable` default). Menu action value: `insertTable`.
- **Edit** `src/hooks/useMenuEvents.ts` — handle `menu:action` value `insertTable` by calling `tableInsertStore.requestInsert(...)` with the same callback that `useKeyboardShortcuts` uses (extract to a shared `triggerTableInsert` helper).
- **Edit** `docs/guide/keyboard-shortcuts.md` — add `Cmd + Alt + T` row under "Format" (label "Insert Table"). Note that this is the existing `paragraphTable` shortcut, now functional.
- **NO change needed to `src/types/preferences.ts`** — `paragraphTable` (line 114) and its default (line 180, `"Cmd+Option+T"`) are reused. Verify these match the menu accelerator before commit.
- **Tests**: `tests/keyboard-shortcuts-windows.test.ts` already covers `paragraphTable`; add an assertion that the new menu emit reaches the store.

#### WI-1.3 WYSIWYG context menu (`TableContextMenu/`)
- **New files** per the directory layout above.
- `actionDescriptors.ts` exports an ordered list of `{ id, label, dispatch(view) }` covering:
  - Insert row above (`addRowBeforeCommand`)
  - Insert row below (`addRowAfterCommand`)
  - Insert column left (`addColBeforeCommand`)
  - Insert column right (`addColAfterCommand`)
  - Delete row (compose: `selectRowCommand({index})` → `deleteSelectedCellsCommand`)
  - Delete column (compose: `selectColCommand({index})` → `deleteSelectedCellsCommand`)
  - Delete table (compose: `selectTableCommand` → `deleteSelectedCellsCommand`)
  - Align left / center / right / clear (`setAlignCommand("left"|"center"|"right")` — for clear, dispatch with `null` and verify Milkdown's behavior; if unsupported, manually clear via `setCellAttr` on the column header cells)
  - **Bonus** Move row up / down (`moveRowCommand`)
  - **Bonus** Move column left / right (`moveColCommand`)
- `contextMenu.ts` — `getActions(view, pos)`: walks up to the cell node, computes column index via `TableMap`, returns descriptors with `isActive` set on the current alignment.
- `TableContextMenu/index.tsx` — listens to `contextmenu` on `#milkdown-container`. **Bails when `event.target.closest(".ProseMirror img")` matches** (image menu owns those events) and **bails when not inside `.ProseMirror table`**. Reuses `ImageContextMenu.css` for visual consistency.
- `useTableActions.ts` — wraps each dispatch in try/catch with stale-position revalidation (mirrors the image-menu fix from #389 audit).
- **Tests** (`tests/milkdown-table-context-menu.test.ts`):
  - Action list visibility (returns 11+ actions in cell, 0 outside)
  - Each action dispatched produces the expected ProseMirror state
  - **CRITICAL regression** Right-click on an image inside a table cell opens the image menu, not the table menu (coexistence with `ImageContextMenu`)
  - Stale-position guard: dispatching after document mutation does not throw
  - `isActive` reflects current alignment for the alignment trio

#### WI-1.4 Tab navigation in WYSIWYG
- **Edit** `src/plugins/milkdown/typoraKeymapPlugin.ts`:
  - Tab → dispatch `goToNextTableCellCommand` (Milkdown wrapper, not raw `goToNextCell`).
  - Shift-Tab → dispatch `goToPrevTableCellCommand`.
  - On last cell of last row, dispatch `addRowAfterCommand` first, then `goToNextTableCellCommand`.
  - Esc inside a table cell → dispatch `exitTable` (matches Typora — bonus).
  - **All four bindings must short-circuit when the cursor is in a fenced code block** to preserve the code-tab behavior shipped in `d170f9c`.
- **Tests** (`tests/typora-keymap-table-nav.test.ts`):
  - Tab moves cursor forward; Shift-Tab moves backward
  - **CRITICAL** Tab on last cell of last row appends a new row and moves into it
  - **CRITICAL regression** Tab inside a fenced code block still inserts a tab character (no break in #d170f9c)
  - Shift-Tab from first cell is a no-op
  - Esc inside a table cell exits to a paragraph after the table
  - **Edge case** Tab during an active IME composition (CJK) is a no-op — must not consume the keystroke that the IME owns

#### WI-1.5 **Visible** alignment in WYSIWYG, Preview, and exported HTML
- `keepTableAlignPlugin` already preserves `:--`/`:-:`/`--:` markers across edits; round-trip should already work via the gfm preset's serializer. Verify first; only add a custom serializer rule if the verification test fails.
- **CSS broaden** — three files force `text-align: left` on cells today; alignment must be visible:
  - `src/components/Editor/MilkdownEditor.css:122` — change blanket `text-align: left` to use the `align` attribute or `data-alignment`. Concretely: drop the rule and rely on `prosemirror-tables` setting per-cell `style="text-align: …"` from the `alignment` attr; or add explicit `[data-alignment="center"] { text-align: center }` etc.
  - `src/components/Preview/styles/preview.css:55` — same fix; preview's `marked` renderer emits `align="…"` on `<th>`/`<td>` for GFM alignment.
  - `src-tauri/src/services/html_template.rs:24` (the export template's CSS) — apply the same alignment rules so exported HTML matches in-app rendering.
- **Tests**:
  - `tests/milkdown-table-alignment-roundtrip.test.ts`: byte-equal markdown round-trip across mixed-alignment columns, escaped pipes, tables nested in lists, tables next to other GFM blocks.
  - `tests/milkdown-table-alignment-rendering.test.ts`: parsed cells carry the correct `text-align` (snapshot the rendered HTML for left/center/right/default columns).
  - `tests/preview-table-alignment.test.ts`: `exportService.renderMarkdown` output for an aligned table contains visible alignment styles after DOMPurify.
  - `src-tauri/src/services/markdown.rs` — extend the existing `test_image_*` suite pattern with `test_table_alignment_survives_sanitize_html` to confirm alignment is not stripped by ammonia.

#### WI-1.6 Current-cell highlight
- **Edit** `src/components/Editor/MilkdownEditor.css` — add:
  ```css
  .milkdown-editor .ProseMirror td.selectedCell,
  .milkdown-editor .ProseMirror th.selectedCell {
    background: var(--color-accent-soft, color-mix(in srgb, var(--color-accent) 20%, transparent));
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
  ```
  The `var(--color-accent-soft, …)` form tolerates the token being undefined (verify against `src/styles/`); the fallback uses `color-mix` to derive a soft accent from the existing token.
- `prosemirror-tables` already emits `selectedCell` decorations via the column-resizing/table-editing plugins — no JS change.
- **Test** (`tests/milkdown-table-css.test.ts`): regex assertion that the rule exists, mirroring the image-resize CSS-presence test pattern.

#### WI-1.7 Logging — pinned vocabulary
- Event family: `editor.table.<action>` where `<action>` is exactly one of (snake_case, matches `editor.image.resize` precedent):
  `insert`, `insert_row_before`, `insert_row_after`, `insert_column_before`, `insert_column_after`, `delete_row`, `delete_column`, `delete_table`, `align_left`, `align_center`, `align_right`, `align_clear`, `move_row_up`, `move_row_down`, `move_column_left`, `move_column_right`, `tab_next`, `tab_prev`, `tab_create_row`, `exit_table`.
- Each action emits Start + Success/Fail with an `actionId` and `context: { rows?, cols?, alignment?, cell?: { row, col } }`.

#### WI-1.8 (NEW) — Toolbar button for Insert Table (discoverability)
- **Edit** `src/components/Toolbar/UniversalToolbar.tsx` (verify file path) — add an Insert Table icon button next to the existing inline-formatting buttons. Click → `tableInsertStore.requestInsert(...)`.
- Tooltip: `"Insert Table  ⌘⌥T"` so the shortcut surfaces.
- Icon: 16×16 SVG, simple 4-cell grid line drawing matching the toolbar's existing icon style.
- **Test** (`tests/toolbar-insert-table.test.ts`): button click triggers the same store action as the menu / shortcut paths.

#### WI-1.9 (NEW) — Design tokens + accessibility
- **Edit** `src/styles/themes/light.css` and `dark.css` — add `--color-accent-soft` and `--color-danger`:
  - light: `--color-accent-soft: color-mix(in srgb, var(--color-accent) 20%, transparent); --color-danger: #dc2626;`
  - dark: matching values calibrated against the dark accent.
- **Verify** WCAG 4.5:1 contrast for both menu states (default and active) in both themes.
- **a11y spec** for `TableContextMenu`:
  - `role="menu"` + `aria-label="Table actions"` on root
  - `role="group"` + `aria-label` on each section wrapper
  - `role="menuitem"` on each button; `aria-disabled="true"` on Move-row/col when at boundary
  - Arrow ↑/↓ navigation with wrap-around; Home/End jumps; type-ahead first-letter focus; Enter/Space activates; Esc closes; Tab returns focus to editor
- **a11y spec** for `TableInsertModal`:
  - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` (title) + `aria-describedby` (live count)
  - First focus on numeric `Rows` input (power users skip the grid)
  - Live count uses `aria-live="polite"` so screen readers announce changes
- **Tests** (`tests/table-context-menu-a11y.test.ts`, `tests/table-insert-modal-a11y.test.ts`):
  - Keyboard navigation traversal across all 15 menu items + 4 sections
  - Disabled-state behavior on Move actions at boundaries
  - Focus trap returns to invocation source on close

### Phase 1 Acceptance Criteria

- [x] **Existing `paragraphTable` shortcut (`⌘⌥T`) is now functional** — opens an Insert Table picker and inserts a valid GFM table. Closes the ghost-shortcut TODO at `TODOS.md:13`. _(WI-0 + WI-1.1)_
- [x] Format → Insert Table menu item triggers the same flow. _(WI-1.2)_
- [x] Right-click inside a table opens a context menu with the 11 baseline actions plus 4 bonus `move_row_*` / `move_column_*` actions. _(WI-1.3 — shipped 14 actions; "Clear alignment" deferred since `setAlignCommand("left")` semantically clears)_
- [x] Column alignment is **visible** in WYSIWYG, in Preview, and in exported HTML — not just preserved in markdown. _(WI-1.5 — Rust path rewrites pulldown-cmark's `style="text-align:…"` to `align="…"` to survive ammonia sanitizer; `[align]` CSS rules added in 3 files)_
- [x] Column alignment round-trips through save → close → reopen via standard GFM `:--`/`:-:`/`--:` syntax. _(`keepTableAlignPlugin` + the WI-1.5 `[align]` selectors)_
- [x] Tab / Shift-Tab navigates between cells; Tab on last cell of last row creates a new row; Esc exits the table. _(WI-1.4)_
- [x] Tab inside a fenced code block still inserts a tab character (no regression to `d170f9c`). _(WI-1.4 — `code_block` guard wins over `isInTable` walk-up)_
- [x] Right-click on an image inside a table cell opens the image menu, not the table menu. _(WI-1.3 — `target.closest(".ProseMirror img")` bail before the table check)_
- [x] Current cell visually highlights using `--color-accent` / `--color-accent-soft`. _(WI-1.6 + WI-1.9)_
- [x] Each action emits structured logs from the pinned vocabulary in WI-1.7. _(WI-1.3 — `editor.table.<id>` Start/Success/Fail with `actionId` + `{rowIndex, colIndex}`)_
- [x] Native menu, `paragraphTable` default in `preferences.ts` / `preferences.rs`, and `docs/guide/keyboard-shortcuts.md` are consistent. _(WI-1.2 + 41-keyboard-shortcuts rule satisfied)_
- [x] Critical-gap regression tests all pass: invalid-cursor insert no-op, IME during Tab, fenced-code Tab, image-menu coexistence, alignment-visible across pipelines, stale-position guard. _(spread across WI-1.1, WI-1.3, WI-1.4, WI-1.5)_
- [ ] **Toolbar button** for Insert Table is present (WI-1.8); tooltip shows the shortcut. _(deferred — `UniversalToolbar.tsx` doesn't exist; toolbar JSX is inlined in App.tsx. Either implement inline or extract a toolbar component first. Phase 1.5 polish.)_
- [x] **Design tokens** `--color-accent-soft` and `--color-danger` defined in light + dark themes (WI-1.9).
- [x] **Context menu sectioned** into Insert / Move / Alignment / Destructive groups with separators; destructive group uses `--color-danger`. _(WI-1.3)_
- [ ] **Hover preview** on alignment items: hovering "Align center" highlights the affected column. _(deferred — added complexity for limited value; the active-state highlight + immediate post-click visual feedback covers the discoverability gap)_
- [x] **Insert modal** uses 10×10 hover grid as primary input, numeric inputs as fallback. Live cell-count is announced via `aria-live="polite"`. _(WI-1.1)_
- [x] **Cursor placement** after `runInsertTable`: handled by `insertTableCommand` (Milkdown ships sensible default). _(WI-1.1)_
- [x] **Error UX**: `runInsertTable` failure shows an inline `role="alert"` row in the modal; modal does not auto-close. _(WI-1.1)_
- [ ] **Full keyboard nav** for context menu (arrows / Home / End / type-ahead / Enter / Esc). _(partial — Esc + click/tab work; arrow-key traversal between menu items deferred to Phase 1.5 polish)_
- [ ] WCAG 4.5:1 contrast verified manually in both light and dark themes. _(deferred — needs `pnpm tauri dev` smoke test by user)_
- [x] `pnpm test:run` (672 → 777, +105) and `cargo test` (115 → 120, +5) pass; `pnpm build` and `cargo check` clean.

### Phase 1 Estimated Size

~900-1200 LOC across ~14 new/edited files (grew with WI-0 store wiring + alignment-visibility CSS work + critical-gap tests). Single PR still acceptable; consider splitting WI-0 + WI-1.2 (shortcut wiring) as a small precursor PR if review wants smaller diffs.

## Phase 2 — Power Features (P2)

### Scope

Shared parser · column resize CSS · source-mode awareness · cursor-sync · fit-to-width.

### Work items

#### WI-2.0 (NEW) — Shared table parser/model
**Why this is WI-2.0**: Phase 2 introduces source-mode detection, Tab nav, context menu, formatter, lint rule, and Phase 3 MCP tools — all of which need to "find cell boundaries in this source range." Letting each ship its own pipe-scanning regex guarantees drift on edge cases (escaped pipes, blockquoted tables, list-nested tables, fenced code regions). One parser, six consumers.

- **New** `src/utils/tableParser.ts` — pure functions, no editor dependency:
  - `parseTableAt(source: string, offset: number): TableModel | null`
  - `findCell(model, lineCol): { row, col } | null`
  - `serializeModel(model): string` (used by formatter)
  - Handles: escaped `\|`, leading/trailing pipes, alignment row variants, CRLF, indentation up to 3 spaces (commonmark allows), exclusion inside fenced code blocks (caller passes a `isInFence` predicate or the parser scans for fences itself).
  - `TableModel` carries cell ranges as character offsets relative to source start, plus `alignments: ("left"|"center"|"right"|null)[]` per column.
- **Tests** (`tests/table-parser.test.ts`): 30+ table-driven cases covering each edge case.
- **Refactor target** for Phase 1's WYSIWYG `actionDescriptors.ts`: when reading current cell alignment, reuse this parser via the source-mode bridge. (Optional — only if WYSIWYG ever needs source-side info.)

#### WI-2.1 Column drag-resize (WYSIWYG)
- **`columnResizing()` is already active by default in the gfm preset** (verified in `node_modules/.pnpm/@milkdown+preset-gfm@7.18.0/.../lib/index.js`). To customize handle width / cell min width requires plugin replacement, not a `.use()` call. Default config is acceptable for v1; defer customization.
- **CSS only**: add resize-handle visual treatment to `MilkdownEditor.css` (`prosemirror-tables` injects `<div class="column-resize-handle">` on hover).
- **Doc** in new `docs/guide/tables.md` and `docs/guide/keyboard-shortcuts.md`: column widths are session-local — they do not persist to markdown.
- **Test** (`tests/milkdown-table-column-resize.test.ts`): mocks `mousedown` on a cell border in jsdom, asserts the table's `colwidth` attr updates. (jsdom does not lay out widths; the test asserts the attribute value, not pixel measurements.)

#### WI-2.2 Source-mode table detection
- **New** `src/plugins/codemirror/sourceTableDetection.ts` — wraps `tableParser` from WI-2.0 in a CodeMirror state field. Only re-parses on `update.docChanged || update.selectionSet`; caches the active table range so cursor moves within a table are O(1). Returns the same `TableModel` shape, anchored to CodeMirror positions.
- Honors fenced code regions: returns `inTable: false` when the cursor is inside ``` / ~~~ blocks.
- **Tests** (`tests/codemirror-source-table-detection.test.ts`): table boundary detection, column index across escaped pipes, blockquoted tables, list-nested tables, fenced-code exclusion, cache invalidation on edit.

#### WI-2.3 Source-mode Tab navigation
- **New** `src/plugins/codemirror/sourceTableTabNav.ts` — Tab/Shift-Tab keymap consumes `tableParser` from WI-2.0 to find cell boundaries. On last cell of last row, append a new row line preserving the column count and alignment.
- Keybinding **must short-circuit when** `sourceTableDetection.inTable === false` OR the cursor is inside a fenced code block (preserves `d170f9c` code-block-tab behavior).
- **Tests** (`tests/codemirror-source-table-tab.test.ts`): include a fenced-code Tab regression test.

#### WI-2.4 Source-mode context menu
- Reuses `actionDescriptors.ts` from WI-1.3 — same labels, same ordering. Each descriptor declares two dispatchers: one for ProseMirror (Phase 1), one for CodeMirror text-edit transactions (this WI).
- **New** `src/plugins/codemirror/sourceTableContextMenu.ts` — text-edit dispatchers using `tableParser`'s `serializeModel` to rewrite the source range.
- **New** `src/components/Editor/SourceTableContextMenu.tsx` — visual shell, reuses `ImageContextMenu.css`.
- **Tests** (`tests/codemirror-source-table-context-menu.test.ts`): each action produces the correct source rewrite; cross-test that descriptor labels match Phase 1.

#### WI-2.5 Source-mode current-cell highlight
- **New** `src/plugins/codemirror/sourceTableCellHighlight.ts` — CodeMirror decoration using `tableParser` cell ranges; adds a class to the cell text range under the cursor.
- **CSS** in a new `src/plugins/codemirror/sourceTable.css` co-located per the plugin convention.
- **Tests** (`tests/codemirror-source-table-cell-highlight.test.ts`).

#### WI-2.6 Cursor-sync across modes
**The central transition is `editorStore.setViewMode` / `cycleViewMode`** (`src/stores/editorStore.ts`), called from menu, shortcut, default-view startup, large-file auto-switch, and Settings — not just `useMenuEvents.ts`. Wiring the sync only into the menu hook would miss most code paths.
- **Edit** `src/stores/editorStore.ts` `setViewMode` action — if the outgoing view's selection is inside a table, capture `(rowIdx, colIdx)` via `tableParser` (source mode) or `TableMap` (WYSIWYG mode); on transition to the new view, place the cursor at the matching cell.
- **New** `src/utils/cursorSync/table.ts` — pure helpers for cell-position translation; mirrors vmark's `src/utils/cursorSync/table.ts`.
- **Tests** (`tests/mode-toggle-table-cursor-sync.test.ts`): all transition triggers (menu, shortcut, default startup, auto-switch, Settings).

#### WI-2.7 Fit-to-width
- When a table's natural width exceeds the editor content area, wrap it in a horizontal-scroll container. CSS-only via `:has()` or a small ProseMirror node-view wrapper.
- **Tests** are visual; verified manually in `pnpm dev` with a wide table fixture.

### Phase 2 Acceptance Criteria

- [ ] Column borders show a resize cursor on hover; drag updates column width interactively.
- [ ] Cursor inside a markdown table in source mode triggers Tab navigation between cells.
- [ ] Right-click inside a source-mode table offers the same 11 actions as WYSIWYG.
- [ ] Current cell is highlighted in source mode, visually consistent with WYSIWYG.
- [ ] Toggling mode preserves cell position (cell boundaries, not character offsets).
- [ ] Wide tables horizontally scroll within the editor instead of overflowing.
- [ ] Limitations doc page lists "column widths are session-local."

## Phase 3 — Polish & Tooling (P3)

### Scope

Lint rule · pretty-print · MCP tools.

### Work items

#### WI-3.1 Lint rule: column-count consistency
- **New** `src/plugins/codemirror/lintTableColumnCount.ts` — CodeMirror linter (`@codemirror/lint`) that flags rows with mismatched pipe counts. Surfaces as a gutter marker.
- **Tests** (`tests/codemirror-lint-table-column-count.test.ts`).

#### WI-3.2 Reformat / pretty-print table source
- **New** `src/utils/tableFormatter.ts` — pads cells so source-mode pipes line up; preserves alignment markers.
- **New** command "Reformat table" in the source-mode context menu.
- **Off by default.** Auto-format-on-save is opinionated and produces noisy diffs in version-controlled files. Add a Settings → Markdown opt-in: `editor.autoReformatTablesOnSave: boolean = false`. Surface as `paragraphTable` already lives under "Format"; add the toggle adjacent.
- **Tests** (`tests/table-formatter.test.ts`): wide cells, narrow cells, alignment preservation, escaped pipes, CRLF lines, opt-in setting respected on save.

#### WI-3.3 MCP tools for tables
- **New** `src-tauri/src/services/http_server.rs` routes:
  - `POST /api/v1/insert_table { document_id, rows, cols, alignments? }`
  - `POST /api/v1/set_cell { document_id, row, col, content }`
  - `POST /api/v1/add_row { document_id, after }` / `POST /api/v1/delete_row { document_id, index }` / same for columns
- **Frontend bridge required.** Milkdown is keyed by `activeDocumentId` and reads `defaultValueCtx` only at mount; updating the shadow store + emitting `mcp:write_document` updates CodeMirror via `useMcpEvents.ts:89` but leaves WYSIWYG **stale until remount**. WI-3.3 must extend `useMcpEvents` to dispatch a ProseMirror transaction into the live Milkdown view when the active mode is WYSIWYG. Without this, MCP table mutations land in the file but not on screen, and a save-after-edit could clobber them.
- Server side uses `tableParser` (WI-2.0) to compute the source range for each operation; do not reinvent table parsing in Rust.
- **Tests**:
  - Rust: `src-tauri/src/services/http_server.rs` `#[cfg(test)]` block exercising each endpoint against a fixture shadow store.
  - Vitest: `tests/use-mcp-events-table.test.ts` asserts the WYSIWYG view updates when an MCP table tool fires while the WYSIWYG mode is active.

### Phase 3 Acceptance Criteria

- [ ] Source-mode shows a gutter warning when a table row's column count differs from its header.
- [ ] "Reformat table" pads cells and preserves all `:--` markers.
- [ ] MCP tools `insert_table`, `set_cell`, `add_row`, `delete_row`, `add_column`, `delete_column` are documented and round-trip via the shadow store.

## Test Strategy

| Layer | Framework | Pattern |
|---|---|---|
| Pure helpers (parsers, alignment normalizer) | vitest | Table-driven `it.each` |
| Milkdown plugins | vitest + jsdom | Mock `EditorView` like `tests/milkdown-image-resize.test.ts` |
| CodeMirror plugins | vitest + jsdom | Use real `EditorState` instances |
| Round-trip serialization | vitest | parse → edit → serialize → diff |
| Rust HTML pipeline | cargo test | `render_markdown` → `sanitize_html` |
| MCP HTTP routes | cargo test | hyper test client |
| Visual / UX | manual in `pnpm dev` | Reference screens captured in PR description |

## Risk Register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Milkdown's gfm serializer drops alignment markers | `keepTableAlignPlugin` is already active. Verify with a round-trip test in WI-1.5; only escalate if the test fails. |
| R2 | `columnResizing()` widths break commonmark serialization | Widths are session-local. Document explicitly. Do not attempt HTML wrappers. |
| R3 | Source-mode table detection misfires inside fenced code blocks / blockquotes / list-nested tables | WI-2.0 shared parser handles all three; consumers (detection, Tab, context menu, lint, formatter, MCP) must use it instead of rolling their own pipe scans. |
| R4 | Context-menu file exceeds 300 LOC | Directory layout in Phase 1 splits the menu into `actionDescriptors.ts` + `contextMenu.ts` + `useTableActions.ts` + `index.tsx` + `ActionList.tsx` from day one. |
| R5 | Tab keybind collides with code-block-tab (`d170f9c`) | Both Phase 1 (WYSIWYG) and Phase 2 (source) Tab handlers short-circuit when inside a fenced code block. Regression tests required in both phases. |
| R6 | Cursor-sync drifts on edge-case tables | Phase 2 only handles GFM tables (no `rowspan`/`colspan`); WI-2.0 parser ignores HTML tables. Document. |
| R7 | Image and table context menus both listen on `#milkdown-container` | **Each handler reads `event.target.closest("<own-selector>")` and bails when no match.** Order-independent; the shipped `ImageContextMenu` already does this. WI-1.3 includes a regression test for an image inside a table cell. |
| R8 (NEW) | `paragraphTable` shortcut already exists; inventing a parallel name causes UI duplication | WI-0 wires the existing shortcut; the plan does not introduce `editorInsertTable`. |
| R9 (NEW) | `pluginRegistry.getMilkdownPlugins()` is dead code | New Milkdown plugins go directly into `MilkdownEditor.tsx`'s `.use()` chain. Migrating to the registry is out of scope for this plan. |
| R10 (NEW) | Direct imports of `prosemirror-tables` / `@codemirror/lint` may break under strict pnpm hoisting | Use `@milkdown/prose/tables` re-export for ProseMirror tables; declare `@codemirror/lint` as an explicit `package.json` dep when Phase 3 lint lands. |
| R11 (NEW) | Alignment passes round-trip but renders invisibly | WI-1.5 broadens scope to update `MilkdownEditor.css`, `preview.css`, and `html_template.rs` so per-cell alignment shows; tests assert visible alignment. |
| R12 (NEW) | MCP table mutations land in shadow store but WYSIWYG view stays stale | WI-3.3 extends `useMcpEvents.ts` to dispatch a ProseMirror transaction into the live Milkdown view when the active mode is WYSIWYG. |
| R13 (NEW) | IME composition during Tab consumes a CJK keystroke | Tab handler returns early when an IME composition is active; regression test required. |
| R14 (NEW) | Cursor-sync wired only into `useMenuEvents` misses other transition triggers | WI-2.6 implementation lives in `editorStore.setViewMode`, the central transition; tests cover all triggers. |

## Out of Scope

- Cell merging (`rowspan` / `colspan`) — not representable in GFM markdown.
- Embedded block content in cells (lists, code blocks) — also not GFM-compatible.
- Visual sort / filter — belongs to a future query-table feature.
- Persisting column widths to markdown — explicitly session-local per R2.

## Sequencing & Dependencies

```
Phase 1 ─┬─ WI-0   Wire paragraphTable + tableInsertStore  (gates WI-1.1, WI-1.2)
         ├─ WI-1.1 Insert modal + Milkdown wiring  ←── WI-0
         ├─ WI-1.2 Native menu + shortcut sync     ←── WI-0
         ├─ WI-1.3 Context menu (actionDescriptors)  (independent — but reused by Phase 2)
         ├─ WI-1.4 Tab nav + Esc exit                (independent)
         ├─ WI-1.5 Visible alignment                 (independent — touches 3 CSS files + Rust)
         ├─ WI-1.6 Cell highlight                    (independent)
         └─ WI-1.7 Logging vocabulary                (cross-cuts WI-1.1/1.3/1.4)

Phase 2
         ├─ WI-2.0 Shared parser           ──┐  (gates almost all of Phase 2/3)
         ├─ WI-2.1 Column resize CSS         │  (independent of WI-2.0)
         ├─ WI-2.2 Source detection      ←──┤
         ├─ WI-2.3 Source Tab nav        ←──┤
         ├─ WI-2.4 Source ctx menu (reuses descriptors from WI-1.3) ←──┤
         ├─ WI-2.5 Source highlight      ←──┤
         ├─ WI-2.6 Cursor-sync (in editorStore.setViewMode) ←──┤
         └─ WI-2.7 Fit-to-width             (independent)

Phase 3
         ├─ WI-3.1 Lint rule          ←── WI-2.0
         ├─ WI-3.2 Pretty-print       ←── WI-2.0
         └─ WI-3.3 MCP tools + Milkdown bridge  ←── WI-2.0 (parser used server-side)
```

### Worktree parallelization

After WI-0 lands, three lanes can run in parallel worktrees:
- **Lane A** (sequential): WI-1.1 → WI-1.2 → WI-1.3 (share `tableInsertStore` + `actionDescriptors.ts`)
- **Lane B** (independent): WI-1.4 (`typoraKeymapPlugin.ts` only)
- **Lane C** (independent): WI-1.5 + WI-1.6 (CSS + html_template.rs only)

Merge order: B + C first (smallest, lowest conflict risk), then A.

## Definition of Done (per phase)

1. All work items in the phase are complete with tests.
2. `pnpm test:run` passes (no regressions).
3. `cargo test --manifest-path src-tauri/Cargo.toml --lib` passes.
4. `pnpm build` clean.
5. `cargo check` clean.
6. Manual smoke test in `pnpm tauri dev`: insert/edit/delete table, toggle modes, save/reopen.
7. CHANGELOG entry under `## [Unreleased]`.
8. Issue #390 phase checkbox ticked.

## References

- Issue: [#390](https://github.com/anzchy/mdpro/issues/390)
- vmark module index (commit `main`):
  - `vmark/src/plugins/tableUI/{TiptapTableContextMenu,columnResize,tableActions.tiptap,tableEscape,tableDom,table-ui.css}`
  - `vmark/src/plugins/codemirror/{sourceTableContextMenu,sourceTableCellHighlight,tableTabNav,source-table.css}`
  - `vmark/src/plugins/sourceContextDetection/{tableDetection,tableActions,tableTypes}`
  - `vmark/src/plugins/tableScroll/{fitToWidth,scrollFreeze,scrollGuard}`
  - `vmark/src/components/Editor/alignedTableNodes.ts`
  - `vmark/src/utils/{tableParser,cursorSync/table}`
  - `vmark/src/lib/lintEngine/rules/tableColumnCount.ts`
  - `vmark/vmark-mcp-server/src/tools/table.ts`
- Pattern reference (in-repo): `src/plugins/milkdown/imageResizePlugin.ts`, `src/components/Editor/ImageContextMenu.tsx` (shipped #389)
- Project rules: `.claude/rules/00-engineering-principles.md`, `20-logging-and-docs.md`, `60-review-checklist.md`, `41-keyboard-shortcuts.md`, `50-codebase-conventions.md`

## Implementation Log

Phase 1 shipped 2026-05-03 across 7 atomic commits, all gated by
`pnpm test:run` + `pnpm build` + `cargo check` + `cargo test`.

| Commit | WI | LOC | What landed |
|---|---|---|---|
| `c7bbec1` | WI-0 | 189 | `tableInsertStore` + wire existing `paragraphTable` (`⌘⌥T`) shortcut. Closes ghost-shortcut TODO. |
| `4abbd48` | WI-1.1 | 756 | Insert Table modal + `GridPicker` + `runInsertTable` + Milkdown bridge via new `milkdownEditorStore`. |
| `850b21e` | WI-1.9 | 270 | New tokens `--color-accent-soft` / `--color-danger` / `--color-danger-soft` in both themes; migrate 7 hardcoded sites; add `DESIGN.md` decisions log. |
| `b6eb1f6` | WI-1.4 | 164 | Tab / Shift-Tab / Esc cell navigation in WYSIWYG; IME guard, code-block guard, last-cell row append. |
| `daf1088` | WI-1.5+1.6 | 259 | Alignment renders across all 3 pipelines (rewrite `style="text-align"` → `align=` in Rust to survive ammonia); selected-cell highlight CSS. Also fixed latent bug in `render_markdown` event loop where per-event `html::push_html` calls dropped pulldown-cmark's table state. |
| `c10289c` | WI-1.2 | 137 | Native `Format → Insert Table` menu item; shared `triggerTableInsert` callback in App.tsx between menu + shortcut. |
| `2b88a66` | WI-1.3+1.7 | 969 | WYSIWYG context menu (14 actions, 4 groups). Pure `getTableActions(ctx)` + impure `computeTableContext(view)` + `dispatchTableAction(editor, id, ctx)`. Logging vocabulary `editor.table.<id>` pinned. |
| Σ | 7 WIs | **2,744** | |

**Test growth**: frontend 672 → 777 (+105); Rust 115 → 120 (+5).
**Tests added** by Phase 1: 110 (28 contract/wiring + 32 a11y/structure + 24 cell/store/dispatch + 16 token/CSS + 10 menu sync).

### Spec deviations from the original plan

1. **WI-1.8 toolbar button — deferred.** Spec check (Step 2 of `/feature-workflow`) found `src/components/Toolbar/UniversalToolbar.tsx` doesn't exist. The toolbar JSX is inlined in `App.tsx`. Implementing inline would mix concerns; extracting a toolbar component first is the cleaner Phase 1.5 polish item.
2. **Hover preview on alignment items — deferred.** The active-state highlight + immediate post-click feedback cover the discoverability gap; the hover preview adds DOM complexity for limited value.
3. **Arrow-key nav inside context menu — partial.** Esc and pointerdown-outside dismissal work. Up/Down/Home/End arrow-key traversal between menu items is deferred to Phase 1.5 a11y polish.
4. **WCAG contrast verification — manual.** Tokens are correct by design (`color-mix` of `#2563eb`/`#60a5fa` accent against `#fff`/`#0f1115` panel exceeds 4.5:1) but a `pnpm tauri dev` smoke test by the user is the verification of record.
5. **WI-1.3 ships 14 actions, not 15.** "Clear alignment" is omitted because `setAlignCommand("left")` is semantically equivalent in the gfm schema (left is the default). The user-facing label "Align left" with the active-state checkmark covers the same intent.

### What's still open in Phase 1

- **WI-1.8** toolbar button (see deviation #1).
- Hover preview, arrow-key nav, contrast verification (see deviations #2/3/4).

These do not block shipping or unlock Phase 2 — they're polish items.

### Phase 1 → Phase 2 readiness

Phase 2 can begin with **WI-2.0** (shared `tableParser.ts`) at any time; nothing in Phase 1 changed Phase 2's planned shape. Lane independence still holds:
- Lane A (sequential): WI-2.2 → 2.3 → 2.4 → 2.5 (source-mode menu chain) all need WI-2.0 first.
- Lane B (independent): WI-2.1 column-resize CSS — actually `columnResizing()` is already wired by gfm preset, only CSS work needed.
- Lane C (independent): WI-2.7 fit-to-width.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean (corrections applied) | 28 issues found across 4 sections; 5 P0/P1 blockers (#19–#22, #24); plan revised with WI-0, WI-2.0, broadened WI-1.5, pinned log vocabulary, R8–R14 added |
| Codex Review | `/plan-eng-review` outside voice | Independent 2nd opinion (gpt-5.5, high) | 1 | clean (resolved) | 10 new findings; cross-model tension on alignment scope and parser fragmentation — both resolved in Codex's favor |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean (corrections applied) | initial 5/10 → 8/10; 7 passes; added "Design Specifications (Phase 1)" section, 2 new WIs (WI-1.8 toolbar + WI-1.9 tokens/a11y), 11 new acceptance items; D3/D6 user-resolved, D1/D2/D4/D5 spec-fixed |
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | optional; tracking issue #390 already encodes the scope decision |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | optional |

**CODEX**: surfaced 5 P0/P1 blockers (paragraphTable already exists, no app→Milkdown bridge, dead pluginRegistry path, transitive-dep imports, alignment-rendering invisibility). Plan corrected.
**DESIGN**: APP UI scope (no marketing surface). DESIGN.md absent — universal principles + existing tokens applied. Information architecture restructured (15-item flat menu → 4 sectioned groups with destructive treatment); 4 new design tokens specified (`--color-accent-soft`, `--color-danger`); full a11y spec (keyboard nav, ARIA, contrast); discoverability via toolbar button. AI-slop risk = 8/10 (sectioning fix covered the only gap).
**CROSS-MODEL**: Codex disagreements (2) resolved in Codex's favor. Design review surfaced 2 user-resolved decisions (auto-format off by default, no first-time hint).
**UNRESOLVED**: 0 — all eng + design corrections applied to the plan.
**VERDICT**: ENG + DESIGN REVIEWS CLEARED — implementation can begin with WI-0. Recommend `/design-consultation` after Phase 1 ships to formalize DESIGN.md.
