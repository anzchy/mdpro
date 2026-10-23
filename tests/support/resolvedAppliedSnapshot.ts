import { defaultAppliedShortcuts, appliedStoredShortcuts } from "../../src/commands/appliedKeymap";
import { resolveBindings } from "../../src/commands/bindingConflicts";
import type { Resolution, StoredBindings } from "../../src/commands/bindingConflicts.types";
import type { Platform } from "../../src/commands/commandTable.types";
import type { AppliedBinding, AppliedShortcuts } from "../../src/types/keyboardShortcuts";
import type { KeyboardShortcuts } from "../../src/types/preferences";

function appliedBinding(result: Resolution): AppliedBinding {
  switch (result.kind) {
    case "bound": return { state: "bound", chord: result.chord };
    case "unassigned": return { state: "unassigned" };
    case "system": return { state: "system" };
    case "suppressed": return { state: "suppressed", reason: result.reason };
  }
}

/** Model the startup resolver → applied snapshot path for mounted editor tests. */
export function resolvedAppliedSnapshot(platform: Platform, overrides: StoredBindings): AppliedShortcuts {
  const defaults = appliedStoredShortcuts(defaultAppliedShortcuts(platform));
  const resolved = resolveBindings(platform, 2, { ...defaults, ...overrides });
  const fields = Object.keys(defaults) as (keyof KeyboardShortcuts)[];
  return {
    keyboardShortcutsVersion: 2,
    source: "loaded",
    bindings: Object.fromEntries(fields.map((field) => [field, appliedBinding(resolved[field])])) as AppliedShortcuts["bindings"],
  };
}
