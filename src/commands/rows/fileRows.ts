/**
 * Purpose: command-table rows for the File group of `KeyboardShortcuts`.
 * v1 = today's defaults; v2 = plan § 5.3.2 (inert until M1b, ADR-0114
 * Decision 9). Menu paths and menu ids are today's (`menu.rs`).
 *
 * @coordinates-with src/commands/commandTable.ts — assembles the rows
 */
import type { CommandRow, MenuPath} from "../commandTable.types";
import { configurable, macOff } from "../rowBuilders";

export const FILE_ROWS: readonly CommandRow[] = [
  configurable({
    id: "file.new",
    field: "fileNew",
    menuId: "menu.file.new",
    menu: ["File", "New"],
    v1: "Cmd+N",
    v2: "Cmd+N",
    availability: ["both", "both"],
  }),
  configurable({
    id: "file.newWindow",
    field: "fileNewWindow",
    menuId: "menu.file.new_window",
    menu: ["File", "New Window"],
    v1: "Cmd+Shift+N",
    v2: "Cmd+Shift+N",
    availability: ["both", "both"],
  }),
  configurable({
    id: "file.open",
    field: "fileOpen",
    menuId: "menu.file.open",
    menu: ["File", "Open..."],
    v1: "Cmd+O",
    v2: "Cmd+O",
    availability: ["both", "both"],
  }),
  configurable({
    id: "file.openQuickly",
    field: "fileOpenQuickly",
    v1: "Cmd+Shift+O",
    v2: "<unassigned>",
    availability: ["none", "none"],
    contexts: ["editorW", "editorS", "tableW", "tableS"],
  }),
  configurable({
    id: "file.save",
    field: "fileSave",
    menuId: "menu.file.save",
    menu: ["File", "Save"],
    v1: "Cmd+S",
    v2: "Cmd+S",
    availability: ["both", "both"],
  }),
  configurable({
    id: "file.saveAs",
    menuId: "menu.file.save_as",
    menu: macOff<MenuPath>(["File", "Save As..."], "none"),
    field: "fileSaveAs",
    v1: "Cmd+Shift+S",
    v2: "Cmd+Shift+S",
    availability: ["none", "none"],
    contexts: ["editorW", "editorS", "tableW", "tableS"],
  }),
  configurable({
    id: "file.close",
    field: "fileClose",
    menuId: "menu.file.close",
    menu: ["File", "Close"],
    v1: "Cmd+W",
    v2: "Cmd+W",
    availability: ["both", "both"],
  }),
  configurable({
    id: "file.preferences",
    field: "filePreferences",
    menuId: "menu.file.preferences",
    menu: macOff<MenuPath>(["mdpro", "Settings..."], ["mdpro", "Preferences..."]),
    v1: "Cmd+,",
    v2: "Cmd+,",
    availability: ["both", "both"],
  }),
  configurable({
    id: "file.exportHtml",
    field: "fileExportHtml",
    menuId: "menu.file.export_html",
    menu: ["File", "Export HTML..."],
    v1: "Cmd+Shift+E",
    v2: "Cmd+Shift+E",
    availability: ["both", "both"],
  }),
];
