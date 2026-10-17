/**
 * Purpose: the K8 physical-overlap rule of the binding conflict filter (audit
 * b186 F1). A Shift binding on a digit or symbol key also matches its
 * physical key (`src/utils/shortcutMatch.ts`), so A = mods+Shift+k1 and
 * B = the same mods+k2 meet on one keypress wherever Shift+k1 types k2. The
 * hook gives that keypress to B (logical before physical), so the filter
 * suppresses A and leaves B bound. The Rust twin is
 * `src-tauri/src/services/binding_conflicts_physical.rs`, with the same table.
 *
 * Limit: the table covers the US and German layouts only. Other layouts
 * (AZERTY, Nordic, …) get the logical-priority fix in the hook, which stops
 * the misfire on any layout, but not the Settings refusal or the resolver
 * flag.
 *
 * @coordinates-with src/commands/bindingConflicts.ts — the only caller
 */

/** The 21 K8 keys: binding character → [US shifted, German shifted]. */
export const SHIFTED_ON_LAYOUTS: ReadonlyMap<string, readonly [string, string]> = new Map([
  ["0", [")", "="]], ["1", ["!", "!"]], ["2", ["@", '"']], ["3", ["#", "§"]], ["4", ["$", "$"]],
  ["5", ["%", "%"]], ["6", ["^", "&"]], ["7", ["&", "/"]], ["8", ["*", "("]], ["9", ["(", ")"]],
  ["`", ["~", "°"]], ["-", ["_", "?"]], ["=", ["+", "`"]], ["[", ["{", "Ü"]], ["]", ["}", "*"]],
  ["\\", ["|", "'"]], [";", [":", "Ö"]], ["'", ['"', "Ä"]], [",", ["<", ";"]], [".", [">", ":"]],
  ["/", ["?", "_"]],
]);

/** True when `a` and `b` (normal forms) meet as A and B on some table layout. */
export function physicallyShadowedBy(a: string, b: string): boolean {
  const [aMods, aKey] = split(a);
  const [bMods, bKey] = split(b);
  if (aMods !== bMods || aKey === bKey || !aMods.split("+").includes("Shift")) return false;
  return (SHIFTED_ON_LAYOUTS.get(aKey) ?? []).some((typed) => typed.toUpperCase() === bKey);
}

/** A normal form split into its modifiers and its key (the key is never "+"). */
function split(chord: string): readonly [string, string] {
  const i = chord.lastIndexOf("+");
  return [chord.slice(0, Math.max(i, 0)), chord.slice(i + 1)];
}
