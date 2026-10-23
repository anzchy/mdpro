/** Convert a run's applied shortcut snapshot to editor keymap syntax. */
import { parseChord } from "./chord";
import type { Platform } from "./commandTable.types";
import type { AppliedShortcuts } from "../types/keyboardShortcuts";
import { DEFAULT_KEYBOARD_SHORTCUTS, type KeyboardShortcuts } from "../types/preferences";
import { rowByPrefField } from "./commandTable";

/** Browser/test default snapshot. Desktop consumers receive the startup IPC snapshot. */
export function defaultAppliedShortcuts(platform: Platform = "macos"): AppliedShortcuts {
  return {
    keyboardShortcutsVersion: 2,
    source: "loaded",
    bindings: Object.fromEntries(Object.entries(DEFAULT_KEYBOARD_SHORTCUTS).map(([field, fallback]) => {
      const spec = rowByPrefField(field as keyof KeyboardShortcuts)?.key[platform];
      const chord = spec?.kind === "configurable" ? spec.defaults.v2 : fallback;
      return [field,
      chord === "<unassigned>" ? { state: "unassigned" } :
        chord === "<system>" ? { state: "system" } : { state: "bound", chord },
      ];
    })) as AppliedShortcuts["bindings"],
  };
}

let runSnapshot: AppliedShortcuts | null = null;

/** Install the IPC result once per window. Null means pending or failed and binds no key. */
export function installAppliedShortcuts(applied: AppliedShortcuts | null): void {
  runSnapshot = applied;
}

export function currentAppliedShortcuts(): AppliedShortcuts | null {
  return runSnapshot;
}

/** Build a composed plugin list against a specific window snapshot. */
export function withAppliedShortcuts<T>(applied: AppliedShortcuts | null, build: () => T): T {
  const previous = runSnapshot;
  runSnapshot = applied;
  try { return build(); }
  finally { runSnapshot = previous; }
}

/** Present the run's active chords to consumers of the old stored-string shape. */
export function appliedStoredShortcuts(applied: AppliedShortcuts): KeyboardShortcuts {
  return Object.fromEntries(Object.keys(DEFAULT_KEYBOARD_SHORTCUTS).map((field) => {
    const binding = applied.bindings[field as keyof KeyboardShortcuts];
    return [field, binding?.state === "bound" ? binding.chord :
      binding?.state === "system" ? "<system>" : "<unassigned>"];
  })) as unknown as KeyboardShortcuts;
}

/** A suppressed, unassigned, system-owned or still-loading key has no editor binding. */
export function appliedKey(
  applied: AppliedShortcuts | null,
  field: keyof KeyboardShortcuts,
  platform: Platform,
): string | null {
  const binding = applied?.bindings[field];
  if (binding?.state !== "bound") return null;
  const chord = parseChord(binding.chord, platform);
  if (!chord) return null;
  const parts: string[] = [];
  if (chord.cmd) parts.push(platform === "macos" ? "Mod" : "Ctrl");
  if (chord.ctrl) parts.push("Ctrl");
  if (chord.option) parts.push("Alt");
  if (chord.shift) parts.push("Shift");
  parts.push(chord.key.length === 1 ? chord.key.toLowerCase() : chord.key);
  return parts.join("-");
}

/** ProseMirror tests and keymaps use Mod for the host's primary modifier. */
export function appliedMilkdownKey(
  applied: AppliedShortcuts | null,
  field: keyof KeyboardShortcuts,
  platform: Platform,
): string | null {
  const key = appliedKey(applied, field, platform);
  return key && platform !== "macos" ? key.replace(/^Ctrl-/, "Mod-") : key;
}
