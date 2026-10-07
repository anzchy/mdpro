// @vitest-environment node
/**
 * @module scroll-anchor-mapping.test
 * Purpose: pin the pure scroll-anchor model (WI-8) — the source-side block and
 * heading enumeration, the line ⇄ anchor mapping in both tiers, the pixel-side
 * geometry mapping, and the one-shot slot keyed by documentId.
 *
 * Nothing here touches an editor. The Milkdown side of the 1:1 block
 * correspondence is pinned separately by `scroll-anchor-correspondence.test.ts`.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { commonmarkLanguage } from "@codemirror/lang-markdown";
import {
  anchorFromBlockGeometry,
  anchorFromSourceLine,
  buildSourceModel,
  consumePendingScrollAnchor,
  enumerateSourceBlocks,
  enumerateSourceHeadings,
  getPendingScrollAnchor,
  headingAnchorFromGeometry,
  pixelOffsetFromAnchor,
  pixelOffsetFromHeadingAnchor,
  setPendingScrollAnchor,
  sourceLineFromAnchor,
  type ScrollAnchor,
} from "../src/utils/scrollAnchor/anchor";

const DOC = "doc-1";

describe("enumerateSourceBlocks — exact line ranges", () => {
  it("a loose list is one block spanning its blank lines", () => {
    expect(enumerateSourceBlocks("- a\n\n- b\n\n- c\n")).toEqual([
      { startLine: 1, endLine: 5 },
    ]);
  });

  it("a setext heading is one block covering both lines", () => {
    expect(enumerateSourceBlocks("Title\n=====\n\npara\n")).toEqual([
      { startLine: 1, endLine: 2 },
      { startLine: 4, endLine: 4 },
    ]);
  });

  it("frontmatter is NOT stripped: hr + setext h2 + body = 3 blocks", () => {
    expect(enumerateSourceBlocks("---\ntitle: x\n---\n\npara\n")).toEqual([
      { startLine: 1, endLine: 1 },
      { startLine: 2, endLine: 3 },
      { startLine: 5, endLine: 5 },
    ]);
  });

  it("skips a link reference definition (remark-inline-links deletes it)", () => {
    expect(
      enumerateSourceBlocks("para [a]\n\n[a]: http://x\n\n# H\n"),
    ).toEqual([
      { startLine: 1, endLine: 1 },
      { startLine: 5, endLine: 5 },
    ]);
  });

  it("skips consecutive link reference definitions", () => {
    expect(
      enumerateSourceBlocks("p [a] [b]\n\n[a]: http://x\n[b]: http://y\n\nq\n"),
    ).toHaveLength(2);
  });

  it("keeps a footnote definition (remark-gfm makes it a footnote_definition node)", () => {
    expect(enumerateSourceBlocks("text[^1]\n\n[^1]: note\n")).toEqual([
      { startLine: 1, endLine: 1 },
      { startLine: 3, endLine: 3 },
    ]);
  });

  it("keeps a top-level <br> HTML block (it survives as an empty paragraph)", () => {
    expect(enumerateSourceBlocks("para\n\n<br>\n\nnext\n")).toEqual([
      { startLine: 1, endLine: 1 },
      { startLine: 3, endLine: 3 },
      { startLine: 5, endLine: 5 },
    ]);
  });

  it("a GFM table interrupting a paragraph is 2 blocks", () => {
    expect(
      enumerateSourceBlocks("para\n| a | b |\n|---|---|\n| 1 | 2 |\n"),
    ).toEqual([
      { startLine: 1, endLine: 1 },
      { startLine: 2, endLine: 4 },
    ]);
  });

  it("companion: the non-GFM tree sees that same input as ONE block", () => {
    const tree = commonmarkLanguage.parser.parse(
      "para\n| a | b |\n|---|---|\n| 1 | 2 |\n",
    );
    let count = 0;
    for (let n = tree.topNode.firstChild; n; n = n.nextSibling) count++;
    expect(count).toBe(1);
  });

  it("an empty document has no blocks", () => {
    expect(enumerateSourceBlocks("")).toEqual([]);
  });

  it("CRLF line endings count lines by \\n", () => {
    expect(enumerateSourceBlocks("# A\r\n\r\npara\r\n")).toEqual([
      { startLine: 1, endLine: 1 },
      { startLine: 3, endLine: 3 },
    ]);
  });
});

describe("enumerateSourceHeadings", () => {
  it("counts nested headings but not `#` inside fenced code", () => {
    expect(
      enumerateSourceHeadings("> # Q\n\n- ## L\n\n```\n# not\n```\n"),
    ).toEqual([1, 3]);
  });

  it("counts the frontmatter setext heading (Milkdown renders it)", () => {
    expect(enumerateSourceHeadings("---\ntitle: x\n---\n\n# H\n")).toEqual([2, 5]);
  });

  it("accepts a Tab after the opening # run, as Milkdown does", () => {
    expect(enumerateSourceHeadings("#\tTitle\n\npara\n")).toEqual([1]);
  });
});

function fence(lines: number): string {
  return ["```js", ...Array.from({ length: lines }, (_, i) => `x${i}`), "```"].join("\n");
}

function table(rows: number): string {
  return [
    "| h1 | h2 |",
    "|---|---|",
    ...Array.from({ length: rows }, (_, i) => `| ${i} | 中${i} |`),
  ].join("\n");
}

const CORPUS = [
  "---\ntitle: Demo\n---",
  "# Intro",
  "Para with 中文 text,\nwrapped onto a second line.",
  fence(40),
  table(10),
  "$$\nx^2 + y^2\n$$",
  "## Setup",
  "- item one\n- item two\n\n- loose item",
  "> quoted\n> twice",
  "## Setup",
  "final paragraph",
].join("\n\n") + "\n";

describe("anchorFromSourceLine ⇄ sourceLineFromAnchor (block tier)", () => {
  for (const [name, content] of [
    ["LF", CORPUS],
    ["CRLF", CORPUS.replace(/\n/g, "\r\n")],
  ] as const) {
    it(`round-trips every line of the mixed corpus within ±1 (${name})`, () => {
      const model = buildSourceModel(content);
      expect(model.blocks).not.toBeNull();
      // Non-vacuity: the corpus is ~80 lines and 12 blocks (frontmatter = 2); a model that saw
      // nothing would iterate zero lines and "pass".
      expect(model.lineCount).toBe(content.split("\n").length);
      expect(model.blocks).toHaveLength(12);
      const failures: string[] = [];
      for (let line = 1; line <= model.lineCount; line++) {
        const anchor = anchorFromSourceLine(model, line, DOC);
        const back = anchor ? sourceLineFromAnchor(model, anchor) : null;
        if (!back || back.tier !== "block" || Math.abs(back.line - line) > 1) {
          failures.push(`L${line} -> ${JSON.stringify(back)}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it("line 1 is block 0 at fraction 0", () => {
    const anchor = anchorFromSourceLine(buildSourceModel(CORPUS), 1, DOC);
    expect(anchor?.block).toEqual({
      blockIndex: 0,
      fraction: 0,
      blockCount: enumerateSourceBlocks(CORPUS).length,
    });
  });

  it("a line past the end clamps to the last block", () => {
    const model = buildSourceModel(CORPUS);
    const anchor = anchorFromSourceLine(model, model.lineCount + 50, DOC);
    expect(anchor?.block?.blockIndex).toBe(model.blocks!.length - 1);
  });

  it("an empty document yields no anchor", () => {
    expect(anchorFromSourceLine(buildSourceModel(""), 1, DOC)).toBeNull();
  });

  it("a blank line maps to the start of the next block — even inside a multi-line gap", () => {
    // Lines: 1 "a", 2-4 blank, 5 "b". The bound for this rule is the gap width,
    // not ±1: every blank line restores to line 5.
    const model = buildSourceModel("a\n\n\n\nb\n");
    for (const line of [2, 3, 4]) {
      const anchor = anchorFromSourceLine(model, line, DOC);
      expect(anchor?.block).toEqual({ blockIndex: 1, fraction: 0, blockCount: 2 });
      expect(sourceLineFromAnchor(model, anchor!)).toEqual({ line: 5, tier: "block" });
    }
  });

  it("the anchor carries the documentId it was captured from", () => {
    expect(anchorFromSourceLine(buildSourceModel(CORPUS), 3, DOC)?.documentId).toBe(DOC);
  });
});

const SETUP_DOC = [
  "# Guide", // 1
  "", // 2
  "## Setup", // 3
  "a", // 4
  "b", // 5
  "## Setup", // 6
  "c", // 7
  "", // 8
  "## Setup", // 9
  "d", // 10
].join("\n");

describe("heading tier", () => {
  it("duplicate headings resolve by ordinal, not by text", () => {
    const model = buildSourceModel(SETUP_DOC);
    expect(model.headingLines).toEqual([1, 3, 6, 9]);
    const anchor = anchorFromSourceLine(model, 7, DOC);
    expect(anchor?.heading).toMatchObject({ headingOrdinal: 2, headingCount: 4 });
  });

  it("falls back to the heading tier when the block count disagrees", () => {
    const model = buildSourceModel(SETUP_DOC);
    const anchor = anchorFromSourceLine(model, 7, DOC)!;
    const drifted: ScrollAnchor = {
      ...anchor,
      block: { ...anchor.block!, blockCount: anchor.block!.blockCount + 1 },
    };
    const back = sourceLineFromAnchor(model, drifted);
    expect(back?.tier).toBe("heading");
    expect(back!.line).toBeGreaterThanOrEqual(6);
    expect(back!.line).toBeLessThan(9);
  });

  it("drops the anchor when both counts disagree", () => {
    const model = buildSourceModel(SETUP_DOC);
    const anchor = anchorFromSourceLine(model, 7, DOC)!;
    expect(
      sourceLineFromAnchor(model, {
        ...anchor,
        block: { ...anchor.block!, blockCount: 99 },
        heading: { ...anchor.heading!, headingCount: 99 },
      }),
    ).toBeNull();
  });

  it("uses the heading tier when the model has no block tier (large document)", () => {
    const model = buildSourceModel(SETUP_DOC);
    const anchor = anchorFromSourceLine(model, 10, DOC)!;
    const back = sourceLineFromAnchor({ ...model, blocks: null }, anchor);
    expect(back).toEqual({ line: 10, tier: "heading" });
  });

  it("a line above the first heading gets ordinal -1", () => {
    const model = buildSourceModel("intro\n\nmore\n\n# H\n");
    expect(anchorFromSourceLine(model, 3, DOC)?.heading).toMatchObject({
      headingOrdinal: -1,
      headingCount: 1,
    });
  });

  it("a document without headings has no heading tier (no whole-document ratio)", () => {
    expect(anchorFromSourceLine(buildSourceModel("a\n\nb\n"), 1, DOC)?.heading).toBeNull();
  });
});

describe("pixel-side geometry", () => {
  it("anchorFromBlockGeometry is pixel-proportional and clamped", () => {
    const span = { top: 100, height: 200 };
    expect(anchorFromBlockGeometry(3, 10, span, 150)).toEqual({
      blockIndex: 3,
      fraction: 0.25,
      blockCount: 10,
    });
    expect(anchorFromBlockGeometry(3, 10, span, 50).fraction).toBe(0);
    expect(anchorFromBlockGeometry(3, 10, span, 900).fraction).toBe(1);
    expect(anchorFromBlockGeometry(0, 1, { top: 5, height: 0 }, 5).fraction).toBe(0);
  });

  it("pixelOffsetFromAnchor inverts it", () => {
    expect(pixelOffsetFromAnchor(0.25, { top: 100, height: 200 })).toBe(150);
  });

  it("headingAnchorFromGeometry picks the last heading at or above the probe", () => {
    const tops = [100, 400, 700];
    expect(headingAnchorFromGeometry(tops, 0, 1000, 550)).toEqual({
      headingOrdinal: 1,
      fraction: 0.5,
      headingCount: 3,
    });
    expect(headingAnchorFromGeometry(tops, 0, 1000, 50)).toEqual({
      headingOrdinal: -1,
      fraction: 0.5,
      headingCount: 3,
    });
    expect(headingAnchorFromGeometry(tops, 0, 1000, 850)?.headingOrdinal).toBe(2);
    expect(headingAnchorFromGeometry([], 0, 1000, 50)).toBeNull();
  });

  it("pixelOffsetFromHeadingAnchor inverts it, and refuses a count mismatch", () => {
    const tops = [100, 400, 700];
    const anchor = { headingOrdinal: 1, fraction: 0.5, headingCount: 3 };
    expect(pixelOffsetFromHeadingAnchor(anchor, tops, 0, 1000)).toBe(550);
    expect(pixelOffsetFromHeadingAnchor({ ...anchor, headingCount: 4 }, tops, 0, 1000)).toBeNull();
  });
});

describe("one-shot slot", () => {
  const anchor: ScrollAnchor = {
    documentId: DOC,
    block: { blockIndex: 1, fraction: 0, blockCount: 2 },
    heading: null,
  };

  beforeEach(() => setPendingScrollAnchor(null));

  it("consume returns the anchor for its own document", () => {
    setPendingScrollAnchor(anchor);
    expect(consumePendingScrollAnchor(DOC)).toEqual(anchor);
  });

  it("a wrong documentId returns null AND clears the slot", () => {
    setPendingScrollAnchor(anchor);
    expect(consumePendingScrollAnchor("other")).toBeNull();
    expect(getPendingScrollAnchor()).toBeNull();
  });

  it("a double consume returns null the second time", () => {
    setPendingScrollAnchor(anchor);
    consumePendingScrollAnchor(DOC);
    expect(consumePendingScrollAnchor(DOC)).toBeNull();
  });

  it("a null documentId consumes nothing usable", () => {
    setPendingScrollAnchor(anchor);
    expect(consumePendingScrollAnchor(null)).toBeNull();
    expect(getPendingScrollAnchor()).toBeNull();
  });
});
