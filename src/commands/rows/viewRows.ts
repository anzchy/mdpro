/**
 * Purpose: command-table rows for the View group of `KeyboardShortcuts`.
 * v1 = today's defaults; v2 = plan § 5.3.2 with D11 (⌘/ first, F6 second),
 * D15 (off-Mac F11 full screen, unavailable until D255-WI-3d) and C4
 * (Switch Documents ⌃Tab / Ctrl+Tab, reserved and unavailable).
 *
 * @coordinates-with src/commands/commandTable.ts — assembles the rows
 */
import type { CommandRow, OwnershipContext, MenuPath} from "../commandTable.types";
import { configurable, macOff } from "../rowBuilders";

const BOTH: readonly OwnershipContext[] = ["editorW", "editorS", "tableW", "tableS"];

export const VIEW_ROWS: readonly CommandRow[] = [
  configurable({
    id: "view.source",
    field: "viewSource",
    menuId: "menu.view.source",
    menu: ["View", "Source"],
    v1: "Ctrl+2",
    v2: macOff("Ctrl+2", "<unassigned>"),
    availability: ["both", "both"],
  }),
  configurable({
    id: "view.wysiwyg",
    field: "viewWysiwyg",
    menuId: "menu.view.wysiwyg",
    menu: ["View", "WYSIWYG"],
    v1: "Ctrl+4",
    v2: macOff("Ctrl+4", "<unassigned>"),
    availability: ["both", "both"],
  }),
  configurable({
    id: "view.sidebar",
    field: "viewToggleSidebar",
    menuId: "menu.view.toggle_sidebar",
    menu: ["View", "Toggle Sidebar"],
    v1: "Cmd+Shift+L",
    v2: "Cmd+Shift+L",
    availability: ["both", "both"],
  }),
  configurable({
    id: "view.cycleViewMode",
    field: "viewCycleViewMode",
    menuId: "menu.view.cycle",
    menu: ["View", "Cycle View Mode"],
    v1: "Cmd+/",
    v2: "Cmd+/",
    v2Secondaries: ["F6"],
    availability: ["both", "both"],
  }),
  configurable({
    id: "view.toggleFullscreen",
    field: "viewToggleFullscreen",
    v1: "Cmd+Option+F",
    v2: macOff("<system>", "F11"),
    availability: ["none", "none"],
    contexts: BOTH,
  }),
  configurable({
    id: "view.switchDocuments",
    menuId: "menu.view.switch_documents",
    menu: macOff<MenuPath>(["View", "Switch Documents"], "none"),
    field: "viewSwitchDocuments",
    v1: "Cmd+`",
    v2: macOff("Ctrl+Tab", "Cmd+Tab"),
    availability: ["none", "none"],
    contexts: BOTH,
  }),
];
