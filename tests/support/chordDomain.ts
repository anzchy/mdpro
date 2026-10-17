/**
 * @module tests/support/chordDomain
 * Purpose: the WI-5 enumerated chord domain (every modifier subset, in canonical
 * and reversed order, × a 44-key pool; 3 714 valid strings over 3 platforms),
 * shared for the M1A-WI-6 slow Milkdown probe (ADR-0050). `tests/chord.test.ts`
 * keeps its own copy of the same definition; this one is asserted to the same
 * counts so the two cannot drift silently. DOM-free.
 */
import { parseChord } from "../../src/commands/chord";
import type { Platform } from "../../src/commands/commandTable.types";

const MODS = ["Cmd", "Ctrl", "Option", "Shift"] as const;
const VALID_KEYS = [
  "A", "a", "Z", "z", "m", "0", "5", "9",
  "`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/",
  "Up", "ArrowUp", "Down", "ArrowDown", "Left", "ArrowLeft", "Right", "ArrowRight",
  "Space", "Backspace", "Delete", "Enter", "Tab", "Escape", "Home", "End", "PageUp", "PageDown",
  "F1", "F6", "F11", "F12",
];
const INVALID_KEYS = ["F13", "Esc", "é"];
export const KEY_POOL: readonly string[] = [...VALID_KEYS, ...INVALID_KEYS];

/** Every string of the domain (4 224 / 3 = 1 408 per platform). */
export function domainStrings(): string[] {
  const out: string[] = [];
  for (let mask = 0; mask < 16; mask++) {
    const mods = MODS.filter((_, i) => (mask >> i) & 1);
    for (const order of [mods, [...mods].reverse()]) {
      for (const key of KEY_POOL) out.push([...order, key].join("+"));
    }
  }
  return out;
}

/** The valid strings on a platform (1 238 each; 3 714 over the three). */
export function validDomain(p: Platform): string[] {
  return domainStrings().filter((s) => parseChord(s, p) !== null);
}
