/**
 * Purpose: the command table's fixed and native rows: the predefined Edit
 * items, Quit / Exit and its escape item, the macOS app-menu items, the
 * Window menu, the macOS-inserted Full Screen, Themes, About and Help.
 * Menu paths, keys and routes are today's (`menu.rs`, `menu_submenus.rs`,
 * `menu_quit.rs`; plan § 3.2). v2 is the state right after M1b (ADR-0114
 * Decision 9): Hide has no key, the macOS Close Window key is gone,
 * off-Mac Redo keeps Ctrl+Y as primary, and Exit has no key.
 *
 * A row absent on a platform has no menu, no key, availability `none` and
 * route `unavailable` there.
 *
 * @coordinates-with src/commands/commandTable.ts — assembles the rows
 */
import type { CommandRow, MenuPath } from "../commandTable.types";
import { type FixedKey, type MacOff, NO_KEY, fixed, macOff } from "../rowBuilders";

const same = (chord: string): FixedKey => [chord, chord];
const NO_MENU: MenuPath = "none";

/** A native row that exists on macOS only. */
const macNative = (id: string, label: string, menu: string, key: FixedKey): CommandRow =>
  fixed({
    id,
    menu: macOff<MenuPath>([menu, label], NO_MENU),
    key: macOff(key, NO_KEY),
    route: macOff("native", "unavailable"),
    availability: macOff("both", "none"),
  });

const editItem = (id: string, label: string, key: FixedKey | MacOff<FixedKey>): CommandRow =>
  fixed({ id, menu: ["Edit", label], key, route: "native" });

const themeItem = (name: string, label: string): CommandRow =>
  fixed({
    id: `theme.${name}`,
    menuId: `menu.theme.${name}`,
    menu: macOff<MenuPath>(["Themes", label], ["Theme", label]),
    key: NO_KEY,
    route: "frontend",
  });

export const APP_ROWS: readonly CommandRow[] = [
  editItem("edit.undo", "Undo", same("Cmd+Z")),
  editItem("edit.redo", "Redo", macOff(same("Cmd+Shift+Z"), same("Ctrl+Y"))),
  editItem("edit.cut", "Cut", same("Cmd+X")),
  editItem("edit.copy", "Copy", same("Cmd+C")),
  editItem("edit.paste", "Paste", same("Cmd+V")),
  editItem("edit.selectAll", "Select All", same("Cmd+A")),
  fixed({
    id: "app.quit",
    // The off-Mac guarded Exit item's id; macOS uses the predefined Quit.
    menuId: "menu.app.quit",
    menu: macOff<MenuPath>(["mdpro", "Quit mdpro"], ["mdpro", "Exit"]),
    key: macOff(same("Cmd+Q"), NO_KEY),
    route: macOff("native", "rust-quit"),
  }),
  fixed({
    id: "app.stopWaitingQuit",
    menuId: "menu.app.stop_waiting_quit",
    menu: ["mdpro", "Stop Waiting and Quit…"],
    key: NO_KEY,
    route: "rust-quit",
  }),
  fixed({ id: "app.about", menu: ["mdpro", "About mdpro"], key: NO_KEY, route: "native" }),
  macNative("app.hide", "Hide mdpro", "mdpro", ["Cmd+H", null]),
  macNative("app.hideOthers", "Hide Others", "mdpro", same("Cmd+Option+H")),
  macNative("app.showAll", "Show All", "mdpro", NO_KEY),
  fixed({ id: "window.minimize", menu: ["Window", "Minimize"], key: same("Cmd+M"), route: "native" }),
  fixed({
    id: "window.zoom",
    menu: macOff<MenuPath>(["Window", "Zoom"], ["Window", "Maximize"]),
    key: NO_KEY,
    route: "native",
  }),
  fixed({
    id: "window.closeWindow",
    menu: ["Window", "Close Window"],
    key: macOff<FixedKey>(["Cmd+W", null], same("Option+F4")),
    route: "native",
  }),
  macNative("view.enterFullScreen", "Enter Full Screen", "View", same("Cmd+Ctrl+F")),
  themeItem("light", "Light"),
  themeItem("dark", "Dark"),
  themeItem("system", "System"),
  fixed({
    id: "help.mdproHelp",
    menuId: "menu.help.placeholder",
    menu: macOff<MenuPath>(NO_MENU, ["Help", "mdpro Help"]),
    key: NO_KEY,
    route: "unavailable",
    availability: "none",
  }),
  fixed({
    id: "help.keyboardShortcuts",
    menuId: "menu.help.keyboard_shortcuts",
    menu: macOff<MenuPath>(["Help", "Keyboard Shortcuts…"], NO_MENU),
    key: NO_KEY,
    route: macOff("frontend", "unavailable"),
    availability: macOff("both", "none"),
  }),
];
