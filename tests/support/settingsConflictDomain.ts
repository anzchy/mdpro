/** Shared Settings conflict domain and independent binding-resolution oracle (D289). */
import { resolveBindings } from "../../src/commands/bindingConflicts";
import type { Resolution } from "../../src/commands/bindingConflicts.types";
import { COMMAND_TABLE } from "../../src/commands/commandTable";
import type { OwnershipContext, Platform } from "../../src/commands/commandTable.types";
import type { SettingsConflicts } from "../../src/commands/settingsConflicts";
import { V2_DEFAULTS } from "./bindingV2Defaults";

export const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux"];
export const CONTEXTS: readonly OwnershipContext[] = [
  "editorW", "editorS", "tableW", "tableS", "modal", "recorder", "nativeFocus",
];

/** The 9 fields SD14 hid until M7 gave them rows. Literal, not read from src/. */
export const HIDDEN: readonly string[] = [
  "fileOpenQuickly", "fileExportHtml", "formatHighlight",
  "tableInsertRowAbove", "tableInsertRowBelow", "tableInsertColumnLeft",
  "tableInsertColumnRight", "tableDeleteRow", "tableDeleteColumn",
];

export const v2Defaults = (p: Platform): Record<string, string> =>
  Object.fromEntries(Object.entries(V2_DEFAULTS).map(([f, [mac, off]]) => [f, p === "macos" ? mac : off]));

export const keysOf = (r: SettingsConflicts) => [...r.refusing.keys()].map(String).sort();

const fieldOfId = new Map(COMMAND_TABLE.flatMap((r) => (r.prefField === undefined ? [] : [[r.id, String(r.prefField)] as const])));

interface Expected {
  refusing: string[];
  via: Set<string>;
}

/** The oracle: read off `resolveBindings` alone. */
export function expected(p: Platform, v: number, local: Record<string, string>): Expected {
  const res: Record<string, Resolution> = resolveBindings(p, v, local);
  const refusing = new Set<string>();
  const via = new Set<string>();
  for (const [field, r] of Object.entries(res)) {
    if (r.kind !== "suppressed") continue;
    const flag = r.flagged && r.reason !== "unparseable";
    const yieldTo = r.reason === "yieldedToCustom";
    if (!flag && !yieldTo) continue;
    const others = r.conflictsWith.flatMap((id) => (fieldOfId.has(id) ? [fieldOfId.get(id) as string] : []));
    const sides = [field, ...others];
    via.add(flag ? "refused-flag" : "refused-yield");
    if (sides.some((f) => HIDDEN.includes(f))) via.add("refused-formerly-hidden");
    if (sides.every((f) => HIDDEN.includes(f))) via.add("refused-formerly-hidden-only");
    if (flag) refusing.add(field);
    else for (const f of others) refusing.add(f);
  }
  return { refusing: [...refusing].sort(), via };
}
