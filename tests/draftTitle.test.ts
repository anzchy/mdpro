// @vitest-environment node
/**
 * ADR-0035 WI-6 — `extractTitle`, moved out of `useAutoSave.ts` into
 * `src/utils/draftTitle.ts` so the quit backstop names drafts exactly as autosave
 * does. The move must not change behaviour, and these cases pin the helper
 * directly. `tests/useAutoSave.test.ts` was changed with it (an "ADR-0035 changes
 * the spec" block): its extractTitle cases now only check that the hook imports
 * `extractTitle` from `../utils/draftTitle` and keeps no private copy of the
 * regex, because the behaviour they used to pin is tested here.
 */
import { describe, expect, it } from "vitest";
import { extractTitle } from "../src/utils/draftTitle";

describe("DT-1 H1 present, absent, and '#' without a space", () => {
  it.each([
    ["# Hello\nbody", "Hello"],
    ["no heading", "Untitled"],
    ["#NoSpace\n", "Untitled"],
    ["intro\n#  Spaced  \n", "Spaced"],
    ["## H2\n# H1", "H1"],
  ])("extractTitle(%j) is %j", (input, expected) => {
    expect(extractTitle(input)).toBe(expected);
  });
});

describe("DT-2 round-trip property", () => {
  it("returns the trimmed H1 text for any single-line title with visible text", () => {
    const seed = 0xad35_d7_02n;
    let s = seed;
    const below = (n: number): number => {
      s = (s + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
      let z = ((s ^ (s >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
      return Number((z ^ (z >> 31n)) % BigInt(n));
    };
    const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
    const pool = [...ascii, "标", "题", "文", "档", "日本", "\t", ...".*+?^$()[]{}|\\"];
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const draw = (len: number, from: readonly string[]): string =>
      Array.from({ length: len }, () => from[below(from.length)]).join("");

    let checked = 0;
    for (let i = 0; i < 500; i++) {
      const title = draw(1 + below(24), pool);
      if (title.trim() === "") continue;
      const lines = Array.from(
        { length: below(4) },
        () => letters[below(letters.length)] + draw(below(20), pool),
      );
      const content = `# ${title}\n${lines.join("\n")}`;
      expect(extractTitle(content), `seed ${seed} index ${i} ${JSON.stringify(content)}`).toBe(
        title.trim(),
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(450);
  });
});
