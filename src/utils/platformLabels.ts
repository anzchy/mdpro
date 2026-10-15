/**
 * @module utils/platformLabels
 * Purpose: the shortcut strings, key labels and hints mdpro shows, per
 * platform (D190-WI-7, W7).
 *
 * Key decisions:
 * - Stored shortcut strings stay platform-neutral: "Cmd" is the primary
 *   modifier (⌘ on macOS, Ctrl elsewhere) and "Option" is Alt, as
 *   `useKeyboardShortcuts.matchesShortcut` reads them. Only the label changes:
 *   off-Mac "Cmd" shows as "Ctrl", "Option" as "Alt", and "Cmd+Ctrl" collapses
 *   to one "Ctrl". The recorder stores Ctrl as "Cmd" off-Mac and refuses a
 *   chord with the Windows key or AltGr, neither of which triggers a shortcut
 *   there (audit b121).
 * - ADR-0096's three off-Mac keys (Source, WYSIWYG, strikethrough) are shown
 *   in place of their stored defaults, which bind nothing.
 *
 * @coordinates-with src/components/common/settings/KeyboardShortcutsSettings.tsx
 * @coordinates-with src/components/common/settings/AdvancedSettings.tsx
 * @coordinates-with src/components/BottomTabs/BottomTabs.tsx
 * @coordinates-with src/components/BottomTabs/SidebarToggleButton.tsx
 * @coordinates-with src/components/common/RecoveryDialog.tsx
 */
import type { KeyboardShortcuts } from "../types/preferences";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../types/preferences";

/** True on macOS. Read at call time, never at module load (ADR-0049). */
export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
}

/** True on Windows. Read at call time, never at module load (ADR-0049). */
export function isWindowsPlatform(): boolean {
  return typeof navigator !== "undefined" && /Win/i.test(navigator.platform);
}

/** The label a stored shortcut string shows. */
export function shortcutLabel(stored: string, isMac: boolean): string {
  if (isMac) return stored;
  const tokens = stored.split("+").map((t) => (t === "Cmd" ? "Ctrl" : t === "Option" ? "Alt" : t));
  return tokens.filter((t, i) => t !== "Ctrl" || tokens.indexOf("Ctrl") === i).join("+");
}

/** Off-Mac labels for entries whose stored default binds nothing there (ADR-0096). */
const OFF_MAC_DEFAULT_LABELS: Partial<Record<keyof KeyboardShortcuts, string>> = {
  viewSource: "Ctrl+/ (toggle)",
  viewWysiwyg: "Ctrl+/ (toggle)",
  formatStrike: "Alt+Shift+5",
};

/** What Settings → Keyboard Shortcuts shows for one entry. */
export function displayedShortcut(
  key: keyof KeyboardShortcuts,
  stored: string,
  isMac: boolean,
): string {
  const offMac = OFF_MAC_DEFAULT_LABELS[key];
  if (!isMac && offMac !== undefined && stored === DEFAULT_KEYBOARD_SHORTCUTS[key]) return offMac;
  return shortcutLabel(stored, isMac);
}

/** The keydown fields the recorder reads. */
export type RecordedKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
  getModifierState?: (key: string) => boolean;
};

/** Keys that are not actionable on their own and are ignored during capture. */
const NON_ACTIONABLE_KEYS = new Set([
  "Meta", "Control", "Alt", "Shift",
  "Dead", "Unidentified", "CapsLock", "Fn", "Process", "OS", "Win",
]);

/** The shortcut string the recorder stores for a keydown, or null to keep waiting. */
export function recordedShortcut(event: RecordedKey, isMac: boolean): string | null {
  if (NON_ACTIONABLE_KEYS.has(event.key)) return null;
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) return null;
  // Off-Mac the Windows / Super key is never a shortcut modifier.
  if (!isMac && event.metaKey) return null;
  // Off-Mac AltGr (Ctrl+Alt) types characters; the matcher refuses it, so a
  // binding recorded from it could never fire (audit b121).
  if (!isMac && event.getModifierState?.("AltGraph")) return null;

  const parts: string[] = [];
  if (isMac) {
    if (event.metaKey) parts.push("Cmd");
    if (event.ctrlKey) parts.push("Ctrl");
  } else if (event.ctrlKey) {
    parts.push("Cmd");
  }
  if (event.altKey) parts.push("Option");
  if (event.shiftKey) parts.push("Shift");

  let keyName = event.key;
  if (keyName === " ") keyName = "Space";
  else if (keyName === "ArrowUp") keyName = "Up";
  else if (keyName === "ArrowDown") keyName = "Down";
  else if (keyName === "ArrowLeft") keyName = "Left";
  else if (keyName === "ArrowRight") keyName = "Right";
  else if (keyName.length === 1) keyName = keyName.toUpperCase();

  parts.push(keyName);
  return parts.join("+");
}

/** The New Document button's tooltip. */
export function newDocumentTooltip(isMac: boolean): string {
  return isMac ? "New Document (⌘N)" : "New Document (Ctrl+N)";
}

const MAC_MODIFIER_SYMBOLS: Record<string, string> = { Cmd: "⌘", Ctrl: "⌃", Option: "⌥", Shift: "⇧" };

/** A stored shortcut as macOS draws it in menus: "Cmd+Shift+L" → "⌘⇧L". */
export function macShortcutSymbols(stored: string): string {
  return stored
    .split("+")
    .map((t) => MAC_MODIFIER_SYMBOLS[t] ?? t)
    .join("");
}

/**
 * The sidebar toggle's accessible name and tooltip (ADR-0088): the action
 * plus the user's live `viewToggleSidebar` binding (b137 Low). A cleared
 * binding names the action alone.
 */
export function sidebarToggleLabel(
  shown: boolean,
  isMac: boolean,
  binding: string = DEFAULT_KEYBOARD_SHORTCUTS.viewToggleSidebar,
): string {
  const action = shown ? "Hide Sidebar" : "Show Sidebar";
  if (binding === "") return action;
  return `${action} (${isMac ? macShortcutSymbols(binding) : shortcutLabel(binding, false)})`;
}

/** Where the log file is, as the Advanced settings page names it. */
export function logFileHint(isWindows: boolean): string {
  // `~` is the user's home on every platform (services/logger.rs); Windows
  // users know it as %USERPROFILE%.
  return isWindows
    ? "Write structured logs to %USERPROFILE%\\.mdpro\\mdpro.log"
    : "Write structured logs to ~/.mdpro/mdpro.log";
}

/** A draft's `lastModified` (RFC 3339 from Rust) as the recovery dialog shows it. */
export function draftTimeLabel(lastModified: string): string {
  const at = new Date(lastModified);
  return Number.isNaN(at.getTime()) ? lastModified : at.toLocaleString();
}
