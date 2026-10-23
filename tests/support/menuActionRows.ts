/**
 * @module tests/support/menuActionRows
 * Purpose: the menu dispatch table as data: one row per `menu:action` the
 * native menu emits (`menu.rs` `handle_menu_event`, plus `file.open_recent`),
 * naming the handler it reaches, that handler's arguments, and the
 * `ui.menu.select` controlId and context it logs. Also the 14 handler keys.
 *
 * No `src/` imports, so a suite that tests `dispatchMenuAction` directly
 * (`tests/menu-action-table.test.ts`) reads the rows without pulling in the
 * hook or `renderHook`. `menuEventsDomain.ts` re-exports everything here, so
 * the `useMenuEvents` suites import it unchanged (D261-WI-1a).
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 *
 * @coordinates-with tests/support/menuEventsDomain.ts — re-exports these names
 * @coordinates-with src/hooks/menuActionTable.ts — the table these rows describe
 */

export const HANDLER_KEYS = [
  "onNew",
  "onNewWindow",
  "onOpen",
  "onSave",
  "onSaveAs",
  "onClose",
  "onExportHtml",
  "onOpenRecent",
  "onToggleSidebar",
  "onSwitchDocuments",
  "onToggleFullscreen",
  "onHighlight",
  "onInsertTable",
  "onViewModeChange",
  "onCycleViewMode",
  "onThemeModeChange",
  "onOpenPreferences",
] as const;
export type HandlerKey = (typeof HANDLER_KEYS)[number];

// ---------------------------------------------------------------------------
// Dispatch table (menu.rs:239-254 plus file.open_recent)
// ---------------------------------------------------------------------------

export type Row = {
  n: number;
  action: string;
  value?: string;
  key: HandlerKey;
  args: unknown[];
  controlId: string;
  extra: Record<string, unknown>;
};

export const ROWS: Row[] = [
  { n: 1, action: "file.new", key: "onNew", args: [], controlId: "menu.file.new", extra: {} },
  { n: 2, action: "file.new_window", key: "onNewWindow", args: [], controlId: "menu.file.new_window", extra: {} },
  { n: 3, action: "file.open", key: "onOpen", args: [], controlId: "menu.file.open", extra: {} },
  { n: 4, action: "file.save", key: "onSave", args: [], controlId: "menu.file.save", extra: {} },
  { n: 18, action: "file.save_as", key: "onSaveAs", args: [], controlId: "menu.file.save_as", extra: {} },
  { n: 5, action: "file.close", key: "onClose", args: [], controlId: "menu.file.close", extra: {} },
  { n: 6, action: "file.export_html", key: "onExportHtml", args: [], controlId: "menu.file.export_html", extra: {} },
  { n: 7, action: "file.preferences", key: "onOpenPreferences", args: [], controlId: "menu.file.preferences", extra: {} },
  { n: 8, action: "cycle-view-mode", key: "onCycleViewMode", args: [], controlId: "menu.view.cycle", extra: {} },
  { n: 9, action: "set-view-mode", value: "source", key: "onViewModeChange", args: ["source"], controlId: "menu.view.set_mode", extra: { mode: "source" } },
  { n: 10, action: "set-view-mode", value: "wysiwyg", key: "onViewModeChange", args: ["wysiwyg"], controlId: "menu.view.set_mode", extra: { mode: "wysiwyg" } },
  { n: 11, action: "view.toggle_sidebar", key: "onToggleSidebar", args: [], controlId: "menu.view.toggle_sidebar", extra: {} },
  { n: 19, action: "view.switch_documents", key: "onSwitchDocuments", args: [], controlId: "menu.view.switch_documents", extra: {} },
  { n: 20, action: "view.toggle_fullscreen", key: "onToggleFullscreen", args: [], controlId: "menu.view.toggle_fullscreen", extra: {} },
  { n: 12, action: "format.highlight", key: "onHighlight", args: [], controlId: "menu.format.highlight", extra: {} },
  { n: 13, action: "paragraph.table", key: "onInsertTable", args: [], controlId: "menu.format.insert_table", extra: {} },
  { n: 14, action: "theme.light", key: "onThemeModeChange", args: ["light"], controlId: "menu.theme.light", extra: {} },
  { n: 15, action: "theme.dark", key: "onThemeModeChange", args: ["dark"], controlId: "menu.theme.dark", extra: {} },
  { n: 16, action: "theme.system", key: "onThemeModeChange", args: ["system"], controlId: "menu.theme.system", extra: {} },
  { n: 17, action: "file.open_recent", value: "/tmp/a.md", key: "onOpenRecent", args: ["/tmp/a.md"], controlId: "menu.file.open_recent", extra: { filePath: "/tmp/a.md" } },
];

export const payloadOf = (row: Row) =>
  row.value === undefined ? { action: row.action } : { action: row.action, value: row.value };
