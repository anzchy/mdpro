/**
 * Purpose: test one keydown against one stored shortcut string, as a pure
 * function. `useKeyboardShortcuts` owns the platform read and the off-Mac
 * second-pass bookkeeping and passes them in (plan M1A-WI-9a); this module
 * holds no state.
 *
 * K8 (plan M1A-WI-9b): a binding with Shift whose key is a digit or a
 * non-letter symbol also matches on the key's physical `event.code`, so ⇧⌘0
 * reaches "Cmd+Shift+0" whether the layout types ")" (US) or "=" (German).
 * The code match sits in the exact pass, so a Shift binding wins before the
 * off-Mac relaxed pass runs.
 *
 * @coordinates-with src/hooks/useKeyboardShortcuts.ts — the only caller; it
 *   decides `relaxed` and records hits for the off-Mac second pass
 */

/** The parts of a KeyboardEvent the matcher reads. */
export type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
  getModifierState?: (key: string) => boolean;
};

export interface MatchOptions {
  /** macOS: Cmd is metaKey and Ctrl is separate. Elsewhere Ctrl is primary. */
  readonly isMac: boolean;
  /** The off-Mac second pass, run only when no binding matched exactly. */
  readonly relaxed: boolean;
}

/** K8: the physical `event.code` of each digit and non-letter symbol key. */
const PHYSICAL_CODE: ReadonlyMap<string, string> = new Map([
  ...Array.from({ length: 10 }, (_, d): [string, string] => [String(d), `Digit${d}`]),
  ["`", "Backquote"], ["-", "Minus"], ["=", "Equal"], ["[", "BracketLeft"], ["]", "BracketRight"],
  ["\\", "Backslash"], [";", "Semicolon"], ["'", "Quote"], [",", "Comma"], [".", "Period"], ["/", "Slash"],
]);

/** Test a keydown against a stored shortcut string (e.g. "Cmd+Shift+K").
 *
 *  Modifier tokens:
 *   "Cmd"    → primary modifier: metaKey on macOS, ctrlKey on other platforms
 *   "Ctrl"   → ctrlKey. On macOS a modifier distinct from Cmd; off-Mac it is
 *              the primary modifier too, so "Cmd+S", "Ctrl+S" and
 *              "Cmd+Ctrl+S" all mean Ctrl+S there (D190; D50).
 *   "Option" → altKey
 *   "Shift"  → shiftKey
 *
 *  Off-Mac a pressed metaKey (Windows/Super key), or AltGr
 *  (`getModifierState("AltGraph")`), never matches any binding.
 *  On the off-Mac second pass only (`relaxed`), a symbol key bound without
 *  Shift also matches when the layout needs Shift to type it (`event.key` is
 *  the symbol itself, e.g. "/" as Shift+7 on German); letters keep the exact
 *  Shift check. The pass runs only when no binding matched exactly, so a
 *  binding that wants the Shift wins (audit b121).
 *
 *  A Shift binding on a digit or symbol key also matches the key's physical
 *  `event.code` (K8), so the shifted character the layout produces does not
 *  matter; modifiers stay exact and letters never match by code.
 *
 *  Key tokens: uppercase letters/digits map case-insensitively; arrow
 *  abbreviations (Up/Down/Left/Right) map to ArrowX; "Space" maps to " ".
 */
export function matchesShortcut(event: KeyLike, shortcut: string, opts: MatchOptions): boolean {
  const { isMac, relaxed } = opts;
  const parts = shortcut.split("+");
  let wantCmd = false,
    wantCtrl = false,
    wantOption = false,
    wantShift = false;
  let keyPart = "";

  for (const p of parts) {
    if (p === "Cmd") wantCmd = true;
    else if (p === "Ctrl") wantCtrl = true;
    else if (p === "Option") wantOption = true;
    else if (p === "Shift") wantShift = true;
    else keyPart = p; // last non-modifier segment is the key
  }

  // Off-Mac, AltGr arrives as ctrlKey + altKey, the same flags a "Cmd+Option+…"
  // binding wants there. It is a character-input key, never a shortcut chord
  // (#38 excluded it; D190 audit b98). macOS Option is not AltGr: untouched.
  if (!isMac && event.getModifierState?.("AltGraph")) return false;

  const primaryMod = isMac ? event.metaKey : event.ctrlKey;
  const secondaryMod = isMac ? event.ctrlKey : event.metaKey;
  const wantPrimary = isMac ? wantCmd : wantCmd || wantCtrl;
  const wantSecondary = isMac ? wantCtrl : false;
  if (wantPrimary !== primaryMod) return false;
  if (wantSecondary !== secondaryMod) return false;
  if (wantOption !== event.altKey) return false;

  // Normalize the stored key name to what event.key produces
  let normalizedKey: string;
  if (keyPart === "Space") normalizedKey = " ";
  else if (keyPart === "Up") normalizedKey = "ArrowUp";
  else if (keyPart === "Down") normalizedKey = "ArrowDown";
  else if (keyPart === "Left") normalizedKey = "ArrowLeft";
  else if (keyPart === "Right") normalizedKey = "ArrowRight";
  else normalizedKey = keyPart;

  // Off-Mac, a symbol the layout types with Shift ("/" is Shift+7 on German)
  // arrives as that symbol with shiftKey set; a binding without Shift still
  // matches it on the second pass. Letters keep the exact check (D190-WI-7,
  // audits b120, b121).
  const shiftTypedSymbol =
    relaxed && !wantShift && normalizedKey.length === 1 && !/[a-z]/i.test(normalizedKey) && event.key === normalizedKey;
  if (wantShift !== event.shiftKey && !shiftTypedSymbol) return false;

  // K8: Shift + digit/symbol also matches the physical key. Shift is already
  // known to be held here, so a binding without Shift never matches by code.
  // An event without a code (undefined or "") never takes this path.
  const physical = PHYSICAL_CODE.get(normalizedKey);
  if (wantShift && physical !== undefined && event.code === physical) return true;

  // Single-character keys: compare case-insensitively
  return normalizedKey.length === 1
    ? event.key.toUpperCase() === normalizedKey.toUpperCase()
    : event.key === normalizedKey;
}
