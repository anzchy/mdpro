/** Historical v1 oracle for D255 tests after M1b activates v2 defaults. */
import { COMMAND_TABLE } from "../../src/commands/commandTable";
import type { Platform } from "../../src/commands/commandTable.types";
import type { AppliedShortcuts } from "../../src/types/keyboardShortcuts";
import { DEFAULT_KEYBOARD_SHORTCUTS, type KeyboardShortcuts } from "../../src/types/preferences";

export function v1TableDefaults(platform: Platform): KeyboardShortcuts {
  const values: Record<string, string> = { ...DEFAULT_KEYBOARD_SHORTCUTS };
  for (const row of COMMAND_TABLE) {
    if (row.prefField && row.key[platform].kind === "configurable") {
      values[row.prefField] = row.key[platform].defaults.v1;
    }
  }
  return values as unknown as KeyboardShortcuts;
}

export function v1Shortcuts(platform: Platform): KeyboardShortcuts {
  const values = { ...v1TableDefaults(platform) };
  // D255's pre-M1b off-Mac Strike binding lived in the Source plugin,
  // independently of the inert command table's stored default.
  if (platform !== "macos") values.formatStrike = "Option+Shift+5";
  return values;
}

export function v1Applied(platform: Platform): AppliedShortcuts {
  const values = v1Shortcuts(platform);
  return {
    keyboardShortcutsVersion: 1, source: "loaded",
    bindings: Object.fromEntries(Object.entries(values).map(([field, chord]) => [field,
      chord === "<unassigned>" ? { state: "unassigned" } :
        chord === "<system>" ? { state: "system" } : { state: "bound", chord },
    ])) as AppliedShortcuts["bindings"],
  };
}
