/**
 * Purpose: the groups and rows of Settings › Keyboard Shortcuts, derived
 * from the command table (plan § 6 M7, D3, D14), so the page has no second
 * hand-kept list of commands.
 *
 * Key decisions:
 * - Every configurable entry is shown, whatever its availability; the row
 *   state says what it can do (rowState.ts).
 * - A fixed row is shown when it has a key on the platform at the stored
 *   defaults version, and not otherwise (user verdict 2026-10-17,
 *   prototype/m7-fixed-rows: 「A: every fixed row with a key」).
 * - The group is the id's prefix, except Exit, which sits in File off-Mac
 *   (D14). Rows keep the table's order inside their group.
 * - Labels: the panel's own name per field, else the menu item's name on
 *   the platform (trailing ellipsis dropped).
 *
 * @coordinates-with src/commands/commandTable.ts — the rows
 * @coordinates-with src/components/common/settings/KeyboardShortcutsSettings.tsx — the consumer
 */
import { COMMAND_TABLE } from "../../../../commands/commandTable";
import type { CommandRow, Platform } from "../../../../commands/commandTable.types";
import type { KeyboardShortcuts } from "../../../../types/preferences";

export const SHORTCUT_GROUPS = [
  "File",
  "Edit",
  "Paragraph",
  "Format",
  "View",
  "Table",
  "mdpro",
  "Window",
  "Theme",
  "Help",
] as const;

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

const GROUP_OF_PREFIX: Readonly<Record<string, ShortcutGroup>> = {
  file: "File",
  edit: "Edit",
  paragraph: "Paragraph",
  format: "Format",
  view: "View",
  table: "Table",
  app: "mdpro",
  window: "Window",
  theme: "Theme",
  help: "Help",
};

/** The panel's name for each configurable field. */
export const FIELD_LABELS: Readonly<Record<keyof KeyboardShortcuts, string>> = {
  fileNew: "New",
  fileNewWindow: "New Window",
  fileOpen: "Open",
  fileOpenQuickly: "Open Quickly",
  fileSave: "Save",
  fileSaveAs: "Save As",
  fileClose: "Close",
  filePreferences: "Preferences",
  fileExportHtml: "Export HTML",
  editCopyAsMarkdown: "Copy As Markdown",
  editPasteAsPlainText: "Paste As Plain Text",
  editSelectLine: "Select Line",
  editSelectWord: "Select Word",
  editDeleteWord: "Delete Word",
  editJumpToTop: "Jump to Top",
  editJumpToBottom: "Jump to Bottom",
  editFind: "Find",
  editFindNext: "Find Next",
  editFindPrevious: "Find Previous",
  editReplace: "Replace",
  paragraphHeading1: "Heading 1",
  paragraphHeading2: "Heading 2",
  paragraphHeading3: "Heading 3",
  paragraphHeading4: "Heading 4",
  paragraphHeading5: "Heading 5",
  paragraphHeading6: "Heading 6",
  paragraphParagraph: "Paragraph",
  paragraphIncreaseHeading: "Increase Heading",
  paragraphDecreaseHeading: "Decrease Heading",
  paragraphTable: "Table",
  paragraphCodeFences: "Code Fences",
  paragraphMathBlock: "Math Block",
  paragraphQuote: "Quote",
  paragraphOrderedList: "Ordered List",
  paragraphUnorderedList: "Unordered List",
  paragraphIndent: "Indent",
  paragraphOutdent: "Outdent",
  formatStrong: "Bold",
  formatEmphasis: "Italic",
  formatUnderline: "Underline",
  formatCode: "Code",
  formatStrike: "Strikethrough",
  formatHyperlink: "Hyperlink",
  formatImage: "Image",
  formatHighlight: "Highlight",
  formatClearFormat: "Clear Format",
  viewSource: "Source",
  viewWysiwyg: "WYSIWYG",
  viewToggleSidebar: "Toggle Sidebar",
  viewCycleViewMode: "Cycle View Mode",
  viewToggleFullscreen: "Toggle Fullscreen",
  viewSwitchDocuments: "Switch Documents",
  tableInsertRowAbove: "Insert Row Above",
  tableInsertRowBelow: "Insert Row Below",
  tableInsertColumnLeft: "Insert Column Left",
  tableInsertColumnRight: "Insert Column Right",
  tableDeleteRow: "Delete Row",
  tableDeleteColumn: "Delete Column",
};

export interface ShortcutEntry {
  readonly row: CommandRow;
  readonly label: string;
}

export interface ShortcutSection {
  readonly name: ShortcutGroup;
  readonly entries: readonly ShortcutEntry[];
}

/** The group a row is shown in on `platform` (D14). Throws on an unknown prefix. */
export function groupOf(row: CommandRow, platform: Platform): ShortcutGroup {
  if (row.id === "app.quit" && platform !== "macos") return "File";
  const group = GROUP_OF_PREFIX[row.id.slice(0, row.id.indexOf("."))];
  if (group === undefined) throw new Error(`no Settings group for ${row.id}`);
  return group;
}

/** The name a row shows on `platform`. */
export function entryLabel(row: CommandRow, platform: Platform): string {
  if (row.prefField !== undefined) return FIELD_LABELS[row.prefField];
  const menu = row.menu[platform];
  const item = menu === "none" ? undefined : menu[menu.length - 1];
  return (item ?? row.id).replace(/(\.\.\.|…)$/, "");
}

/** Whether a row has a Settings row on `platform` at defaults `version`. */
export function isShownEntry(row: CommandRow, platform: Platform, version: number): boolean {
  if (row.prefField !== undefined) return true;
  return row.key[platform].defaults[version >= 2 ? "v2" : "v1"] !== null;
}

/** The page's sections on `platform` at defaults `version`, empty ones left out. */
export function shortcutSections(platform: Platform, version: number): readonly ShortcutSection[] {
  const byGroup = new Map<ShortcutGroup, ShortcutEntry[]>();
  for (const row of COMMAND_TABLE) {
    if (!isShownEntry(row, platform, version)) continue;
    const group = groupOf(row, platform);
    byGroup.set(group, [...(byGroup.get(group) ?? []), { row, label: entryLabel(row, platform) }]);
  }
  return SHORTCUT_GROUPS.flatMap((name) => {
    const entries = byGroup.get(name);
    return entries === undefined ? [] : [{ name, entries }];
  });
}
