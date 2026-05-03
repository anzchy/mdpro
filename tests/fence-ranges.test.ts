/**
 * @module fence-ranges.test
 * Purpose: Verify the pure source-side fenced-code detector
 * (audit fix H3/H4). Used by `useDocument.saveActiveDocument` and
 * `tableMcp` — both of which run outside a CodeMirror EditorState
 * and so can't call `isPositionInFencedCode(state, pos)`.
 */

import { describe, expect, it } from "vitest";
import {
  findFencedRanges,
  makeIsFenced,
} from "../src/utils/fenceRanges";

describe("findFencedRanges — happy path", () => {
  it("returns no ranges for prose with no fences", () => {
    expect(findFencedRanges("Just prose.\nMore prose.\n")).toEqual([]);
  });

  it("finds a single backtick fence", () => {
    const md = "Before.\n\n```\ncode\nmore code\n```\n\nAfter.\n";
    const ranges = findFencedRanges(md);
    expect(ranges).toHaveLength(1);
    expect(md.slice(ranges[0].start, ranges[0].end)).toContain("```\ncode");
  });

  it("finds a single tilde fence", () => {
    const md = "~~~\nfoo\n~~~\n";
    const ranges = findFencedRanges(md);
    expect(ranges).toHaveLength(1);
  });

  it("finds multiple fences", () => {
    const md = "```\na\n```\n\nbetween\n\n```\nb\n```\n";
    expect(findFencedRanges(md)).toHaveLength(2);
  });

  it("supports backtick + language tag (` ```ts ... ``` `)", () => {
    const md = "```typescript\nconst x = 1;\n```\n";
    const ranges = findFencedRanges(md);
    expect(ranges).toHaveLength(1);
  });

  it("does not confuse ``` inside the fence as the closer (only standalone closes)", () => {
    const md =
      "```\n" +
      "// the ``` symbol used in prose\n" +
      "more code\n" +
      "```\n";
    // The middle line has ``` but is not a closing fence (text after the
    // backticks is non-trivial); the real closer is the standalone ``` line.
    expect(findFencedRanges(md)).toHaveLength(1);
  });

  it("treats different fence chars as independent (~~~ doesn't close ```)", () => {
    const md = "```\n~~~\n```\n";
    expect(findFencedRanges(md)).toHaveLength(1);
  });
});

describe("findFencedRanges — edge cases", () => {
  it("respects up to 3 leading spaces of indent on the opening fence", () => {
    const md = "   ```\ncode\n   ```\n";
    expect(findFencedRanges(md)).toHaveLength(1);
  });

  it("rejects 4+ leading spaces (that's an indented code block, not a fence)", () => {
    const md = "    ```\ncode\n    ```\n";
    expect(findFencedRanges(md)).toEqual([]);
  });

  it("a closing fence needs at least as many backticks as the opener", () => {
    const md = "````\ncode\n```\nstill code\n````\n";
    // Opener has 4 backticks; ``` (3) is NOT a valid closer. Real closer is ```` (4).
    const ranges = findFencedRanges(md);
    expect(ranges).toHaveLength(1);
    expect(md.slice(ranges[0].start, ranges[0].end)).toContain("still code");
  });

  it("handles an unclosed fence by extending to end of source", () => {
    const md = "```\ncode without closer\n";
    const ranges = findFencedRanges(md);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].end).toBe(md.length);
  });
});

describe("makeIsFenced predicate", () => {
  it("returns true for offsets inside fences and false outside", () => {
    const md = "Before.\n\n```\ncode\n```\n\nAfter.\n";
    const isFenced = makeIsFenced(md);
    expect(isFenced(0)).toBe(false); // "Before."
    expect(isFenced(md.indexOf("code"))).toBe(true);
    expect(isFenced(md.indexOf("After."))).toBe(false);
  });

  it("returns false for the empty document", () => {
    expect(makeIsFenced("")(0)).toBe(false);
  });
});
