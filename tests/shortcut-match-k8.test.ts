// @vitest-environment node
/**
 * M1A-WI-9b (K8): a binding with Shift whose key is a digit or a non-letter
 * symbol also matches on the key's physical `event.code`, so ⇧⌘0 (US `key
 * ")"`) and German Ctrl+Shift+0 (`key "="`) both reach `Cmd+Shift+0`.
 * Modifiers stay exact, AltGr is still refused off-Mac, letters and bindings
 * without Shift ignore `event.code`.
 *
 * Mock boundary: none (pure function).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import { matchesShortcut, type KeyLike } from "../src/utils/shortcutMatch";

interface Mods {
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  altGr?: boolean;
}

function ev(key: string, code: string, mods: Mods): KeyLike {
  return {
    key,
    code,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    getModifierState: (k: string) => !!mods.altGr && k === "AltGraph",
  };
}

const match = (e: KeyLike, binding: string, isMac: boolean, relaxed = false) =>
  matchesShortcut(e, binding, { isMac, relaxed });

/** The 21 K8 keys: binding character, physical code, US shifted key, German shifted key. */
const K8_KEYS: ReadonlyArray<readonly [string, string, string, string]> = [
  ["0", "Digit0", ")", "="],
  ["1", "Digit1", "!", "!"],
  ["2", "Digit2", "@", '"'],
  ["3", "Digit3", "#", "§"],
  ["4", "Digit4", "$", "$"],
  ["5", "Digit5", "%", "%"],
  ["6", "Digit6", "^", "&"],
  ["7", "Digit7", "&", "/"],
  ["8", "Digit8", "*", "("],
  ["9", "Digit9", "(", ")"],
  ["`", "Backquote", "~", "°"],
  ["-", "Minus", "_", "?"],
  ["=", "Equal", "+", "`"],
  ["[", "BracketLeft", "{", "Ü"],
  ["]", "BracketRight", "}", "*"],
  ["\\", "Backslash", "|", "'"],
  [";", "Semicolon", ":", "Ö"],
  ["'", "Quote", '"', "Ä"],
  [",", "Comma", "<", ";"],
  [".", "Period", ">", ":"],
  ["/", "Slash", "?", "_"],
];
const K8_CHARS = new Set(K8_KEYS.map(([k]) => k));
const PLATFORMS = [true, false] as const;
const primary = (isMac: boolean): Mods => (isMac ? { meta: true } : { ctrl: true });

describe("K8 acceptance event table", () => {
  const table: ReadonlyArray<[string, boolean, KeyLike, string, boolean, boolean]> = [
    ["k1", true, ev(")", "Digit0", { meta: true, shift: true }), "Cmd+Shift+0", false, true],
    ["k2", true, ev(")", "Digit0", { ctrl: true, shift: true }), "Ctrl+Shift+0", false, true],
    ["k3", false, ev(")", "Digit0", { alt: true, shift: true }), "Option+Shift+0", false, true],
    ["k4", true, ev("~", "Backquote", { meta: true, shift: true }), "Cmd+Shift+`", false, true],
    ["k5", false, ev("=", "Digit0", { ctrl: true, shift: true }), "Cmd+Shift+0", false, true],
    ["k6", false, ev("/", "Digit7", { ctrl: true, shift: true }), "Cmd+/", true, true],
    ["k7", false, ev("/", "Digit7", { ctrl: true, shift: true }), "Cmd+/", false, false],
    ["k8", false, ev("=", "Digit0", { ctrl: true, shift: true }), "Cmd+=", false, false],
    ["k9", true, ev(")", "Digit0", { meta: true, shift: true, alt: true }), "Cmd+Shift+0", false, false],
    ["k10", true, ev("(", "Digit9", { meta: true, shift: true }), "Cmd+Shift+0", false, false],
    ["k11", false, ev("/", "Digit7", { ctrl: true, shift: true }), "Cmd+Shift+/", false, true],
  ];

  it.each(table)("%s isMac=%s", (_id, isMac, e, binding, relaxed, expected) => {
    expect(match(e, binding, isMac, relaxed)).toBe(expected);
  });
});

describe("K8 named failure modes", () => {
  it("a off-Mac AltGr on Digit0 is refused, in both passes", () => {
    const e = ev("}", "Digit0", { ctrl: true, alt: true, shift: true, altGr: true });
    expect(match(e, "Cmd+Option+Shift+0", false, false)).toBe(false);
    expect(match(e, "Cmd+Option+Shift+0", false, true)).toBe(false);
  });

  it("b Ctrl+Shift+S is not Save (letters unchanged)", () => {
    for (const isMac of PLATFORMS) {
      const e = ev("S", "KeyS", { ...primary(isMac), shift: true });
      expect(match(e, "Cmd+S", isMac, false)).toBe(false);
      expect(match(e, "Cmd+S", isMac, true)).toBe(false);
    }
  });

  it("c AZERTY key Q on code KeyA does not match Cmd+Shift+A (no code match for letters)", () => {
    for (const isMac of PLATFORMS) {
      const e = ev("Q", "KeyA", { ...primary(isMac), shift: true });
      expect(match(e, "Cmd+Shift+A", isMac, false)).toBe(false);
      expect(match(e, "Cmd+Shift+A", isMac, true)).toBe(false);
    }
  });

  it("d code alone never matches a binding without Shift: Ctrl+Shift+0 is not Cmd+0", () => {
    const e = ev("=", "Digit0", { ctrl: true, shift: true });
    expect(match(e, "Cmd+0", false, false)).toBe(false);
    expect(match(e, "Cmd+0", false, true)).toBe(false);
  });

  it("e French Ctrl+à on Digit0 without Shift does not match Cmd+0", () => {
    const e = ev("à", "Digit0", { ctrl: true });
    expect(match(e, "Cmd+0", false, false)).toBe(false);
    expect(match(e, "Cmd+0", false, true)).toBe(false);
  });
});

describe("K8 every digit and symbol matches physically on both layouts (S4)", () => {
  it("84 positive, 84 unshifted negative and 84 non-Shift-binding negative cases", () => {
    let positive = 0;
    let unshifted = 0;
    let noShiftBinding = 0;
    const failures: string[] = [];
    for (const isMac of PLATFORMS) {
      for (const [k, code, us, de] of K8_KEYS) {
        for (const key of [us, de]) {
          const shifted = ev(key, code, { ...primary(isMac), shift: true });
          if (!match(shifted, `Cmd+Shift+${k}`, isMac, false)) failures.push(`+ ${isMac} ${k} ${key}`);
          positive++;
          const plain = ev(key, code, primary(isMac));
          if (match(plain, `Cmd+Shift+${k}`, isMac, false)) failures.push(`-noshift ${isMac} ${k} ${key}`);
          unshifted++;
          if (match(shifted, `Cmd+${k}`, isMac, false)) failures.push(`-binding ${isMac} ${k} ${key}`);
          noShiftBinding++;
        }
      }
    }
    expect(failures).toEqual([]);
    expect([positive, unshifted, noShiftBinding]).toEqual([84, 84, 84]);
  });
});

describe("R1-1 K8 adds a code match and never replaces the key match (S6)", () => {
  it("an event whose key is the binding character matches whatever its code (168 checks)", () => {
    let checks = 0;
    const failures: string[] = [];
    for (const isMac of PLATFORMS) {
      for (const [k, own] of K8_KEYS) {
        for (const code of ["", "Digit7", "Digit0", own]) {
          const e = ev(k, code, { ...primary(isMac), shift: true });
          if (!match(e, `Cmd+Shift+${k}`, isMac, false)) failures.push(`${isMac} ${k} ${code}`);
          checks++;
        }
      }
    }
    expect(failures).toEqual([]);
    expect(checks).toBe(168);
  });
});

/** The event a binding's own chord produces on `isMac`, with the given code. */
function ownEvent(binding: string, isMac: boolean): KeyLike {
  const parts = binding.split("+");
  const mods: Mods = {};
  let keyPart = "";
  for (const p of parts) {
    if (p === "Cmd") Object.assign(mods, primary(isMac));
    else if (p === "Ctrl") mods.ctrl = true;
    else if (p === "Option") mods.alt = true;
    else if (p === "Shift") mods.shift = true;
    else keyPart = p;
  }
  const named: Record<string, string> = {
    Space: " ",
    Up: "ArrowUp",
    Down: "ArrowDown",
    Left: "ArrowLeft",
    Right: "ArrowRight",
  };
  const key = named[keyPart] ?? (keyPart.length === 1 ? keyPart.toLowerCase() : keyPart);
  return ev(key, "", mods);
}

describe("event.code is inert outside K8 (metamorphic, S6)", () => {
  it("every code variant gives the same result for non-K8 bindings", () => {
    const isK8Binding = (b: string) => {
      const parts = b.split("+");
      return parts.includes("Shift") && K8_CHARS.has(parts[parts.length - 1]);
    };
    const bindings = [
      ...Object.values(DEFAULT_KEYBOARD_SHORTCUTS).filter((b) => !isK8Binding(b)),
      "Cmd+Shift+K",
      "Cmd+Option+Shift+Backspace",
      "Cmd+Shift+Up",
      "Cmd+Shift+Space",
    ];
    const codes = ["", "Digit0", "KeyA", "Backquote", "Slash"];
    let baseTrue = 0;
    const failures: string[] = [];
    for (const isMac of PLATFORMS) {
      const shiftedEvents = K8_KEYS.flatMap(([, , us, de]) =>
        [us, de].map((key) => ev(key, "", { ...primary(isMac), shift: true })),
      );
      for (const binding of bindings) {
        for (const base of [ownEvent(binding, isMac), ...shiftedEvents]) {
          for (const relaxed of [false, true]) {
            const results = codes.map((code) => match({ ...base, code }, binding, isMac, relaxed));
            if (results[0]) baseTrue++;
            if (results.some((r) => r !== results[0])) failures.push(`${isMac} ${binding} ${base.key} ${relaxed}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
    expect(baseTrue).toBeGreaterThanOrEqual(50);
  });
});
