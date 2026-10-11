// @vitest-environment node
/**
 * D66 — `minimalTextChange` turns a whole-text replacement into the single
 * change that differs, so CodeMirror can map a selection through it.
 *
 * Law checked on every case: applying the change to `oldText` yields `newText`
 * exactly, and the change never splits a UTF-16 surrogate pair.
 */
import { describe, expect, it } from "vitest";
import { minimalTextChange } from "../src/utils/minimalTextChange";

function apply(oldText: string, c: { from: number; to: number; insert: string }): string {
  return oldText.slice(0, c.from) + c.insert + oldText.slice(c.to);
}

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function check(oldText: string, newText: string) {
  const c = minimalTextChange(oldText, newText);
  expect(apply(oldText, c)).toBe(newText);
  expect(c.from).toBeGreaterThanOrEqual(0);
  expect(c.to).toBeGreaterThanOrEqual(c.from);
  expect(c.to).toBeLessThanOrEqual(oldText.length);
  // Neither edge sits between a high and a low surrogate.
  for (const edge of [c.from, c.to]) {
    if (edge > 0 && edge < oldText.length) {
      expect(isHigh(oldText.charCodeAt(edge - 1)), `edge ${edge} splits a pair`).toBe(false);
    }
  }
  return c;
}

describe("minimalTextChange", () => {
  it("MTC-1 a middle edit touches only the differing span", () => {
    expect(check("ab| 1 |cd", "ab| R1 |cd")).toEqual({ from: 4, to: 4, insert: "R" });
  });

  it("MTC-2 identical texts give an empty change", () => {
    const c = check("same text", "same text");
    expect(c.from).toBe(c.to);
    expect(c.insert).toBe("");
  });

  it("MTC-3 empty to text and text to empty", () => {
    expect(check("", "abc")).toEqual({ from: 0, to: 0, insert: "abc" });
    expect(check("abc", "")).toEqual({ from: 0, to: 3, insert: "" });
  });

  it("MTC-4 a repeated run does not let prefix and suffix overlap", () => {
    expect(check("aaa", "aa")).toEqual({ from: 2, to: 3, insert: "" });
    expect(check("aa", "aaa")).toEqual({ from: 2, to: 2, insert: "a" });
    check("abab", "ab");
    check("x\nx\n", "x\n");
  });

  it("MTC-5 an edit next to an astral character keeps the pair whole", () => {
    // U+1F600 = \ud83d\ude00, U+1F601 = \ud83d\ude01: they share the high surrogate.
    const c = check("a😀b", "a😁b");
    expect(c).toEqual({ from: 1, to: 3, insert: "😁" });
    check("😀", "😁");
    check("😀x", "😁x");
    // Same low surrogate, different high one: the suffix must not start mid-pair.
    expect(check("a\ud801\ude00b", "a😀b")).toEqual({ from: 1, to: 3, insert: "😀" });
  });

  it("MTC-6 the change is the narrowest one: prefix and suffix are maximal", () => {
    const oldText = "# T\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nLast line.k\n";
    const newText = "# T\n\n| a | b      |\n| - | ------ |\n| 1 | R1-x-y |\n\nLast line.k\n";
    const c = check(oldText, newText);
    expect(oldText.slice(0, c.from)).toBe("# T\n\n| a | b ");
    expect(oldText.slice(c.to)).toBe(" |\n\nLast line.k\n");
  });
});
