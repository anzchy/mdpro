/**
 * Purpose: parse a stored shortcut string into a chord and normalise it per
 * platform (plan M1A-WI-5, C6). The Rust twin is
 * `src-tauri/src/models/chord.rs`; both are held to the `parse` rows of
 * `tests/fixtures/binding-owner-cases.json`. Inert until M1b: no production
 * module imports it yet.
 *
 * Grammar: `+`-separated; modifiers `Cmd | Ctrl | Option | Shift` (exact
 * case, each at most once) then exactly one key. A key is one printable ASCII
 * character other than `+` (letters are case-insensitive), a named key
 * (exact case; `ArrowUp` etc. alias `Up`), or `F1`–`F12`. A chord with no
 * modifier is valid only for `F1`–`F12`. Anything else, including the
 * sentinels `<unassigned>` / `<system>` and `""`, parses to `null`.
 *
 * Key decisions:
 * - Normal form (SD1): modifiers ordered Cmd, Ctrl, Option, Shift; letters
 *   uppercase; arrows as `Up/Down/Left/Right`. Off-Mac, `Cmd`, `Ctrl` or both
 *   collapse to `Cmd` (the one primary modifier); on macOS they stay apart.
 * - Validity never depends on the platform; only normalisation does.
 * - Total: never throws, whatever the input.
 *
 * @coordinates-with src-tauri/src/models/chord.rs — the same grammar in Rust
 * @coordinates-with src/commands/commandTable.types.ts — `Platform`
 */
import type { Platform } from "./commandTable.types";

/** A parsed chord. `key` is in canonical spelling once normalised. */
export interface Chord {
  readonly cmd: boolean;
  readonly ctrl: boolean;
  readonly option: boolean;
  readonly shift: boolean;
  readonly key: string;
}

type ModifierName = "cmd" | "ctrl" | "option" | "shift";

const MODIFIER_TOKENS: ReadonlyMap<string, ModifierName> = new Map([
  ["Cmd", "cmd"],
  ["Ctrl", "ctrl"],
  ["Option", "option"],
  ["Shift", "shift"],
]);

const ARROW_ALIASES: ReadonlyMap<string, string> = new Map([
  ["ArrowUp", "Up"],
  ["ArrowDown", "Down"],
  ["ArrowLeft", "Left"],
  ["ArrowRight", "Right"],
]);

const NAMED_KEYS: ReadonlySet<string> = new Set([
  "Up", "Down", "Left", "Right", "Space", "Backspace", "Delete", "Enter", "Tab",
  "Escape", "Home", "End", "PageUp", "PageDown",
]);

const FIRST_PRINTABLE = 0x21;
const LAST_PRINTABLE = 0x7e;
const PLUS = 0x2b;
const MAX_FUNCTION_KEY = 12;

function isFunctionKey(key: string): boolean {
  const match = /^F([1-9][0-9]?)$/.exec(key);
  return match !== null && Number(match[1]) <= MAX_FUNCTION_KEY;
}

/** The canonical spelling of a key token, or `null` if it is not a key. */
function canonicalKey(token: string): string | null {
  if (token.length === 1) {
    const code = token.charCodeAt(0);
    if (code < FIRST_PRINTABLE || code > LAST_PRINTABLE || code === PLUS) return null;
    return token.toUpperCase();
  }
  const aliased = ARROW_ALIASES.get(token) ?? token;
  if (NAMED_KEYS.has(aliased) || isFunctionKey(aliased)) return aliased;
  return null;
}

/** Collapse modifiers for the platform and canonicalise the key spelling. */
export function normaliseChord(chord: Chord, platform: Platform): Chord {
  const key = canonicalKey(chord.key) ?? chord.key;
  if (platform === "macos") return { ...chord, key };
  return { ...chord, cmd: chord.cmd || chord.ctrl, ctrl: false, key };
}

/** Parse a stored string and normalise it for `platform`; `null` if unparseable. */
export function parseChord(stored: string, platform: Platform): Chord | null {
  const tokens = stored.split("+");
  const keyToken = tokens.pop();
  if (keyToken === undefined) return null;
  const mods: Record<ModifierName, boolean> = { cmd: false, ctrl: false, option: false, shift: false };
  for (const token of tokens) {
    const name = MODIFIER_TOKENS.get(token);
    if (name === undefined || mods[name]) return null;
    mods[name] = true;
  }
  const key = canonicalKey(keyToken);
  if (key === null) return null;
  if (tokens.length === 0 && !isFunctionKey(key)) return null;
  return normaliseChord({ ...mods, key }, platform);
}

/** Write a chord in stored syntax, modifiers in canonical order. */
export function formatChord(chord: Chord): string {
  const parts: string[] = [];
  if (chord.cmd) parts.push("Cmd");
  if (chord.ctrl) parts.push("Ctrl");
  if (chord.option) parts.push("Option");
  if (chord.shift) parts.push("Shift");
  parts.push(chord.key);
  return parts.join("+");
}

/** The normal form of a stored string on `platform`, or `null` if unparseable. */
export function normaliseStored(stored: string, platform: Platform): string | null {
  const chord = parseChord(stored, platform);
  return chord === null ? null : formatChord(chord);
}
