/**
 * WI-2 — the construct-extraction specification for
 * `src/services/tocService.ts#parseHeadingsFromContent` (ADR-0012).
 *
 * Unit 1 (`tests/toc-position-laws.test.ts`) owns the *position* laws. This file
 * owns what counts as a heading, what its `text` is, and the two decisions the
 * plan required to be written down before code exists: the empty-ATX guard and
 * the `text` normalization rule.
 *
 * These cases describe the POST-swap behaviour. Most of them are RED against the
 * line-regex parser that is here today; that is the point of the file.
 *
 * G0: **no `fast-check`, no new dependency.** Every case is hand-written or rides
 * the WI-1 generator in `tests/helpers/headingDocumentCorpus.ts`.
 *
 * No `vi.mock("@tauri-apps/api/core")` here on purpose:
 * `parseHeadingsFromContent` never calls `invoke`, so mocking that boundary would
 * mock a boundary this unit does not use.
 *
 * ── The `text` normalization rule these cases pin (B6's table, four ordered steps) ──
 *   (a) `\r\n` → `\n`
 *   (b) every remaining lone `\r` → a single **space**, not a deletion
 *   (c) for every line *after the first*, strip a leading, line-anchored
 *       `[ \t]*(?:>[ \t]?)*` prefix
 *   (d) `trim()`
 * Two of the orderings are pinned and are not stylistic: **a before b** (B6 row 5)
 * and **c before d** (B11 row 6). The b-vs-c order is observable only on
 * `"Alpha\n\rBeta\n===\n"`, which nothing here produces, and is deliberately
 * unpinned. Step (b) maps to a space rather than deleting because `slugBase`
 * collapses `[^\p{L}\p{N}]+` to `-`: deleting turns `a\rb` into the id `ab`, while
 * a space preserves `a-b`, which is what the raw text would have produced.
 */
import { describe, expect, it } from "vitest";
import {
  parseHeadingsFromContent,
  type HeadingInfo,
} from "../src/services/tocService";
import { createAnchorSlugAllocator } from "../src/utils/headingIdentity";
import {
  LAW_DOCS,
  generateLawDocuments,
} from "./helpers/headingDocumentCorpus";

/** The full observable shape of one heading. */
const project = (h: HeadingInfo) => ({
  level: h.level,
  text: h.text,
  line: h.line,
  offset: h.offset,
  id: h.id,
});

/** The shape minus `id`, for cases whose expectation does not name the slug. */
const projectPos = (h: HeadingInfo) => ({
  level: h.level,
  text: h.text,
  line: h.line,
  offset: h.offset,
});

const textsOf = (hs: HeadingInfo[]) => hs.map((h) => h.text);

describe("B1: ATX levels 1-6 with text, line and offset", () => {
  it("projects level, text, line and offset over a mixed document", () => {
    const markdown =
      "# H1\n\npara\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n";

    const headings = parseHeadingsFromContent(markdown);

    expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(textsOf(headings)).toEqual(["H1", "H2", "H3", "H4", "H5", "H6"]);
    expect(headings.map((h) => h.line)).toEqual([1, 5, 7, 9, 11, 13]);
    // Literal, not `indexOf`-derived: at least one case must pin absolute
    // arithmetic so a broken derived oracle cannot hide everywhere.
    expect(headings.map((h) => h.offset)).toEqual([0, 12, 19, 27, 36, 46]);
  });
});

describe("B2: closing-sequence ATX, and the `#` that is content", () => {
  it("strips a trailing hash run but keeps an interior `#`", () => {
    expect(parseHeadingsFromContent("### X ###").map(projectPos)).toEqual([
      { level: 3, text: "X", line: 1, offset: 0 },
    ]);
    expect(parseHeadingsFromContent("# Title #").map(projectPos)).toEqual([
      { level: 1, text: "Title", line: 1, offset: 0 },
    ]);
    // Separates "strip the trailing hash run" from "strip every `#`".
    expect(parseHeadingsFromContent("# a # b").map(projectPos)).toEqual([
      { level: 1, text: "a # b", line: 1, offset: 0 },
    ]);
  });
});

describe("B3: `#NoSpace` and `####### SevenHashes` yield nothing", () => {
  it("respects both boundaries of ATX validity", () => {
    const markdown = "#NoSpace\n\n####### SevenHashes\n\n## Valid\n";

    const headings = parseHeadingsFromContent(markdown);

    expect(headings).toHaveLength(1);
    expect(headings.map((h) => h.level)).toEqual([2]);
    expect(textsOf(headings)).toEqual(["Valid"]);
    expect(headings.map((h) => h.line)).toEqual([5]);
  });
});

describe("B4: empty ATX yields nothing", () => {
  // MEASURED: Lezer emits ATXHeading2/3/1 with extracted text "" for the first
  // three. The empty-text guard is what keeps
  // `tests/markdown-editor-core.test.ts:45` green.
  it("drops headings whose extracted text is empty", () => {
    const markdown = "##\n\n###  \n\n#\n\n## Valid Heading\n";

    const headings = parseHeadingsFromContent(markdown);

    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe("Valid Heading");
    expect(headings[0].id).toBe("valid-heading");
    expect(headings.every((h) => h.text !== "")).toBe(true);
  });
});

describe("B5: the empty-text guard keys on text, not on the slug", () => {
  // A guard written as `if (slugBase(text) === "heading") continue` or
  // `if (!id) continue` passes B4 and silently deletes every emoji-only heading.
  it("drops `#` but keeps an emoji-only heading with the fallback id", () => {
    expect(parseHeadingsFromContent("#\n")).toEqual([]);

    const headings = parseHeadingsFromContent("# 🎉\n");

    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe("🎉");
    expect(headings[0].id).toBe("heading");
  });
});

describe("B6: setext headings, LF and CRLF, single-line and multi-line", () => {
  it("row 1: single-line setext H1", () => {
    expect(parseHeadingsFromContent("Alpha\n=====\n").map(project)).toEqual([
      { level: 1, text: "Alpha", line: 1, offset: 0, id: "alpha" },
    ]);
  });

  it("row 2: single-line setext H2", () => {
    expect(parseHeadingsFromContent("Beta\n-----\n").map(project)).toEqual([
      { level: 2, text: "Beta", line: 1, offset: 0, id: "beta" },
    ]);
  });

  it("row 3: single-line setext H1 under CRLF", () => {
    expect(parseHeadingsFromContent("Alpha\r\n===\r\n").map(project)).toEqual([
      { level: 1, text: "Alpha", line: 1, offset: 0, id: "alpha" },
    ]);
  });

  it("row 4: multi-line setext keeps the interior newline", () => {
    const headings = parseHeadingsFromContent("Alpha\nBeta\n===\n");

    expect(headings).toHaveLength(1);
    expect(headings[0].level).toBe(1);
    expect(headings[0].line).toBe(1);
    expect(headings[0].offset).toBe(0);
    expect(headings[0].text).toBe("Alpha\nBeta");
  });

  it("row 5: multi-line setext under CRLF is byte-identical to row 4", () => {
    // Step (a) before step (b): under b-then-a this reads "Alpha \nBeta".
    const headings = parseHeadingsFromContent("Alpha\r\nBeta\r\n===\r\n");

    expect(headings).toHaveLength(1);
    expect(headings[0].level).toBe(1);
    expect(headings[0].line).toBe(1);
    expect(headings[0].offset).toBe(0);
    expect(headings[0].text).toBe("Alpha\nBeta");
  });

  it("row 6: an ATX heading is a leaf block and is not upgraded by an underline", () => {
    const headings = parseHeadingsFromContent("# ATX\n=====\n");

    expect(headings).toHaveLength(1);
    expect(headings[0].level).toBe(1);
    expect(headings[0].text).toBe("ATX");
  });
});

describe("B7: internal whitespace inside heading text is preserved verbatim", () => {
  it("keeps an interior run and drops the run after the marker", () => {
    expect(textsOf(parseHeadingsFromContent("# A    B\n"))).toEqual(["A    B"]);
    expect(
      textsOf(parseHeadingsFromContent("#   Leading spaces after the marker\n")),
    ).toEqual(["Leading spaces after the marker"]);
  });
});

describe("B8: indentation equivalence classes, 0-4 leading spaces", () => {
  // MEASURED: up to three leading spaces is a heading; four is indented code.
  // Behaviour change recorded: 1-3 spaces were NOT headings to the old regex.
  const rows: [string, number][] = [
    ["# A", 0],
    [" # A", 1],
    ["  # A", 2],
    ["   # A", 3],
  ];

  it.each(rows)("indent %j yields one heading at offset %i", (markdown, offset) => {
    expect(parseHeadingsFromContent(markdown).map(projectPos)).toEqual([
      { level: 1, text: "A", line: 1, offset },
    ]);
  });

  it("four leading spaces is an indented code block", () => {
    expect(parseHeadingsFromContent("    # A")).toEqual([]);
  });
});

describe("B9: code contexts never produce headings", () => {
  const FENCE = "```";
  const TILDE = "~~~";

  it("backtick fence", () => {
    expect(parseHeadingsFromContent(`${FENCE}\n# not a heading\n${FENCE}\n`)).toEqual([]);
  });

  it("tilde fence", () => {
    expect(parseHeadingsFromContent(`${TILDE}\n# not a heading\n${TILDE}\n`)).toEqual([]);
  });

  it("info-string fence", () => {
    expect(parseHeadingsFromContent(`${FENCE}md\n# nope\n${FENCE}\n`)).toEqual([]);
  });

  it("unclosed fence running to EOF", () => {
    // The adversarial member: a hand-rolled fence tracker that requires a
    // closing fence emits a heading here.
    expect(parseHeadingsFromContent(`${FENCE}\n# nope\n`)).toEqual([]);
  });

  it("indented code block", () => {
    expect(parseHeadingsFromContent("    # not a heading\n")).toEqual([]);
  });

  it("a fence followed by a real heading", () => {
    const headings = parseHeadingsFromContent(
      `${FENCE}\n# nope\n${FENCE}\n\n# yes\n`,
    );

    expect(textsOf(headings)).toEqual(["yes"]);
    expect(headings[0].line).toBe(5);
  });
});

describe("B10: `HeaderMark` subtraction over markup, CJK and astral text", () => {
  const markdown =
    "# **bold** title\n\n# `code` title\n\n# [text](https://example.com) tail\n\n# a ~~b~~ c\n\n# 架构 🎉 𝔘𝔫𝔦\n\n# www.example.com\n";

  const EXPECTED_TEXTS = [
    "**bold** title",
    "`code` title",
    "[text](https://example.com) tail",
    "a ~~b~~ c",
    "架构 🎉 𝔘𝔫𝔦",
    "www.example.com",
  ];

  it("subtracts only the `#` marks — inline markup is NOT stripped", () => {
    // ADR-0012 Consequences. Stripping LinkMark/EmphasisMark/CodeMark is the
    // deferred successor work, and it must show up here as a red, not silently.
    expect(textsOf(parseHeadingsFromContent(markdown))).toEqual(EXPECTED_TEXTS);
  });

  it("law: ids compose with a fresh shared allocator over the same texts", () => {
    const headings = parseHeadingsFromContent(markdown);
    const allocator = createAnchorSlugAllocator();
    const oracle = EXPECTED_TEXTS.map((t) => allocator.allocate(t) as string);

    expect(headings.map((h) => h.id)).toEqual(oracle);
  });
});

describe("B11: blockquote- and list-nested headings", () => {
  // Behaviour change recorded: rows 1-3 were not headings to the old regex.
  // Decision (plan WI-2): they ARE emitted.
  it("row 1: `> # Quoted`", () => {
    expect(parseHeadingsFromContent("> # Quoted\n").map(project)).toEqual([
      { level: 1, text: "Quoted", line: 1, offset: 2, id: "quoted" },
    ]);
  });

  it("row 2: `- # Item`", () => {
    expect(parseHeadingsFromContent("- # Item\n").map(project)).toEqual([
      { level: 1, text: "Item", line: 1, offset: 2, id: "item" },
    ]);
  });

  it("row 3: `> > # Deep`", () => {
    const markdown = "> > # Deep\n";
    const headings = parseHeadingsFromContent(markdown);

    expect(headings).toHaveLength(1);
    expect(markdown.slice(headings[0].offset).startsWith("# Deep")).toBe(true);
    expect(headings[0].line).toBe(1);
    expect(headings[0].text).toBe("Deep");
  });

  it("row 4: setext inside a blockquote drops the continuation marker", () => {
    // MEASURED raw extraction: "Alpha\n> ". The slug is "alpha" either way, so
    // no slug-based test in the repo can see the leak — only `text` can.
    const headings = parseHeadingsFromContent("> Alpha\n> =====\n");

    expect(headings).toHaveLength(1);
    expect(projectPos(headings[0])).toEqual({
      level: 1,
      text: "Alpha",
      line: 1,
      offset: 2,
    });
  });

  it("row 5: setext inside a list item drops the continuation indent", () => {
    const headings = parseHeadingsFromContent("- Alpha\n  =====\n");

    expect(headings).toHaveLength(1);
    expect(projectPos(headings[0])).toEqual({
      level: 1,
      text: "Alpha",
      line: 1,
      offset: 2,
    });
  });

  it("row 6: the marker is stripped from EVERY continuation line, not just the last", () => {
    // A trailing-only strip (`replace(/\n[ \t>]*$/, "")`) passes rows 4-5, B6
    // row 4, L1, L3 and L5, and produces "Alpha\n> Beta" here. `useTOC.ts:139`
    // normalizes that to "Alpha > Beta", which never equals the rendered
    // textContent "Alpha Beta" — click-to-navigate silently does nothing.
    const quoted = parseHeadingsFromContent("> Alpha\n> Beta\n> ===\n");
    const listed = parseHeadingsFromContent("- Alpha\n  Beta\n  =====\n");

    expect(quoted).toHaveLength(1);
    expect(listed).toHaveLength(1);
    expect(textsOf(quoted)).toEqual(["Alpha\nBeta"]);
    expect(textsOf(listed)).toEqual(["Alpha\nBeta"]);
    expect(quoted.map(projectPos)).toEqual([
      { level: 1, text: "Alpha\nBeta", line: 1, offset: 2 },
    ]);
    expect(listed.map(projectPos)).toEqual([
      { level: 1, text: "Alpha\nBeta", line: 1, offset: 2 },
    ]);
  });
});

describe("B12: frontmatter documents", () => {
  it("row 1: keys are never headings; offsets and lines are rebased", () => {
    const markdown = "---\ntitle: My Doc\n---\n# Real Heading\n## Section";

    const headings = parseHeadingsFromContent(markdown);

    expect(headings).toHaveLength(2);
    expect(textsOf(headings)).toEqual(["Real Heading", "Section"]);
    expect(headings.map((h) => h.line)).toEqual([4, 5]);
    expect(headings.map((h) => h.offset)).toEqual([22, 37]);
  });

  it("row 2: CRLF frontmatter", () => {
    const headings = parseHeadingsFromContent("---\r\ntitle: W\r\n---\r\n# Real\r\n");

    expect(headings).toHaveLength(1);
    expect(projectPos(headings[0])).toEqual({
      level: 1,
      text: "Real",
      line: 4,
      offset: 20,
    });
  });

  it("row 3: frontmatter only", () => {
    expect(parseHeadingsFromContent("---\ntitle: Only frontmatter\n---\n")).toEqual([]);
  });

  it("row 4: an invalid delimiter makes the YAML key a setext H2", () => {
    // Behaviour change the plan does not mention: `stripFrontmatter` is a no-op
    // when the fence carries trailing spaces, so `---  ` is a thematic break,
    // `title: Doc` a paragraph, and the following `---` a setext-H2 underline.
    // CommonMark-correct. If the reviewer rejects it, the fix belongs in
    // `stripFrontmatter`, not in this work item.
    expect(
      parseHeadingsFromContent("---  \ntitle: Doc\n---\nBody.").map(project),
    ).toEqual([
      { level: 2, text: "title: Doc", line: 2, offset: 6, id: "title-doc" },
    ]);
  });
});

describe("B13: degenerate documents", () => {
  it.each([[""], ["   "], ["\n\n\n"], ["   \n\n\t\n"]])(
    "%j yields no headings",
    (markdown) => {
      expect(parseHeadingsFromContent(markdown)).toEqual([]);
    },
  );

  it("a heading-only document with no trailing newline", () => {
    expect(parseHeadingsFromContent("# Solo").map(projectPos)).toEqual([
      { level: 1, text: "Solo", line: 1, offset: 0 },
    ]);
  });

  it("a heading after leading blank lines", () => {
    expect(parseHeadingsFromContent("\n\n# after blanks\n").map(projectPos)).toEqual([
      { level: 1, text: "after blanks", line: 3, offset: 2 },
    ]);
  });
});

describe("B14: a `#` inside a GFM table cell is not a heading", () => {
  it("table cell", () => {
    expect(parseHeadingsFromContent("| a |\n| --- |\n| # b |\n")).toEqual([]);
  });

  it("`Alpha\\n---` stays a setext H2 — GFM's delimiter row requires a pipe", () => {
    expect(parseHeadingsFromContent("Alpha\n---\n").map(projectPos)).toEqual([
      { level: 2, text: "Alpha", line: 1, offset: 0 },
    ]);
  });
});

describe("B15: purity, determinism and a fresh allocator per call", () => {
  const DOCS = [...generateLawDocuments(), ...LAW_DOCS];

  it("two successive calls over the whole law domain are deep-equal", () => {
    for (const doc of DOCS) {
      const first = parseHeadingsFromContent(doc.markdown);
      const second = parseHeadingsFromContent(doc.markdown);

      expect(second, `document=${doc.name}`).toEqual(first);
    }
  });

  it("a fresh allocator per call — `# 架构` yields `架构` on both calls", () => {
    // Hoisting the allocator to module scope makes the second call return
    // `架构-1`. `tests/cjk-slug.test.ts:73` is the existing guard.
    expect(parseHeadingsFromContent("# 架构")[0].id).toBe("架构");
    expect(parseHeadingsFromContent("# 架构")[0].id).toBe("架构");
  });

  it("does not mutate its input", () => {
    const input = ["# A", "## B"].join("\n");

    parseHeadingsFromContent(input);

    expect(input).toBe("# A\n## B");
  });
});

describe("B16: the pairs the existing suite already pins, re-asserted here", () => {
  // `markdown-editor-core.test.ts` is a file this work item must not edit.
  // Re-asserting its claims from the file the implementer IS allowed to edit
  // makes an accidental "fix" of the untouchable file visible as a
  // contradiction between two suites instead of a quiet green.
  it("levels, texts and lines over the core document", () => {
    const markdown = [
      "# Title",
      "Paragraph",
      "## Section",
      "### Subsection ###",
      "not a heading",
      "###### Deep",
    ].join("\n");

    const headings = parseHeadingsFromContent(markdown);

    expect(headings).toHaveLength(4);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 6]);
    expect(textsOf(headings)).toEqual([
      "Title",
      "Section",
      "Subsection",
      "Deep",
    ]);
    expect(headings.map((h) => h.line)).toEqual([1, 3, 4, 6]);
  });

  it("offsets over the core offset document", () => {
    const headings = parseHeadingsFromContent(["# A", "xx", "## B"].join("\n"));

    expect(headings).toHaveLength(2);
    expect(headings.map((h) => h.offset)).toEqual([0, 7]);
  });
});

describe("B17: a lone `\\r` is not a line terminator", () => {
  it("row 1: a lone `\\r` does not advance the line count", () => {
    // MEASURED from=4. "a\rb\n" is four UTF-16 units and exactly one `\n`
    // precedes the heading.
    expect(parseHeadingsFromContent("a\rb\n# H\n").map(project)).toEqual([
      { level: 1, text: "H", line: 2, offset: 4, id: "h" },
    ]);
  });

  it("row 2: `a\\r# H` is one line, so there is no heading", () => {
    // PRESERVED behaviour, not a new defect: today's `/\r?\n/` split does not
    // break on a lone `\r` either, so `a\r# H` was one line before the change
    // and is one line after it. Do not "fix" this.
    expect(parseHeadingsFromContent("a\r# H\n")).toEqual([]);
  });

  it("row 3: inside heading text a lone `\\r` becomes one space, not nothing", () => {
    // The `id` half is the load-bearing one: deleting the `\r` yields text "ab"
    // and id "ab", changing the anchor for a purely presentational character.
    const headings = parseHeadingsFromContent("a\rb\n===\n");

    expect(headings).toHaveLength(1);
    expect(projectPos(headings[0])).toEqual({
      level: 1,
      text: "a b",
      line: 1,
      offset: 0,
    });
    expect(headings[0].id).toBe("a-b");
  });
});

describe("B18: the normalization rule is universal, not the setext helper's private business", () => {
  // The natural wrong implementation splits ATX (mark subtraction + trim) from
  // setext (line-ending normalization + continuation stripping), which puts
  // steps (a)-(c) in the setext helper only. Both ids below are UNCHANGED by
  // the defect — "a\rb" and "a b" both slug to `a-b`, "> Note" and "Note" both
  // slug to `note`. That is the point: no slug-based test in this repo can see
  // either defect, so the `text` half is load-bearing and the `id` half records
  // that the anchor does not move.
  it("row 1: step (b) applies to ATX text too", () => {
    expect(
      parseHeadingsFromContent("# a\rb\n").map((h) => [h.text, h.id]),
    ).toEqual([["a b", "a-b"]]);
  });

  it("row 2: step (c) spares line 0 — a leading `>` there is content", () => {
    // A strip written as `replace(/^[ \t]*(?:>[ \t]?)*/gm, "")` reaches line 0
    // and breaks this row.
    expect(
      parseHeadingsFromContent("# > Note\n").map((h) => [h.text, h.id]),
    ).toEqual([["> Note", "note"]]);
  });
});

/**
 * B19 — a Tab after the opening `#` run (regression, found 2026-09-18).
 *
 * CommonMark §4.2: "The opening sequence of # characters must be followed by
 * spaces or tabs, or by the end of line." The Lezer grammar in
 * `@codemirror/lang-markdown` 6.5.0 accepts only a space, so `#\tTitle` parses
 * as a Paragraph. The old line regex listed it, and the Rust export renderer
 * follows CommonMark and still anchors it — so without this fix the swap closes
 * four sidebar/export disagreements and opens a fifth.
 *
 * The fix rewrites the Tab to a space in a PARSE-ONLY copy. Tab → space is
 * length-preserving, which is the whole reason it is safe: every offset and line
 * number in Unit 1's laws is computed against that copy and is unchanged.
 */
describe("B19: a Tab after the opening # run still opens a heading", () => {
  it("lists tab-opened ATX headings at every level", () => {
    expect(
      parseHeadingsFromContent("#\tTabbed\n").map((h) => [h.level, h.text, h.id]),
    ).toEqual([[1, "Tabbed", "tabbed"]]);
    expect(
      parseHeadingsFromContent("##\tTabbed2\n").map((h) => [h.level, h.text, h.id]),
    ).toEqual([[2, "Tabbed2", "tabbed2"]]);
    expect(
      parseHeadingsFromContent("######\tSix\n").map((h) => h.level),
    ).toEqual([6]);
  });

  it("allows the 0-3 space indent CommonMark allows, and stops at 4", () => {
    expect(
      parseHeadingsFromContent("   ##\tDeep\n").map((h) => [h.level, h.text, h.offset]),
    ).toEqual([[2, "Deep", 3]]);
    // 4 spaces is an indented code block — not a heading, tab or no tab.
    expect(parseHeadingsFromContent("    #\tCode\n")).toEqual([]);
  });

  it("keeps offsets and lines exactly where the space form puts them", () => {
    const tabbed = parseHeadingsFromContent("para\n\n#\tTabbed\n\nmore\n");
    const spaced = parseHeadingsFromContent("para\n\n# Tabbed\n\nmore\n");
    expect(tabbed).toEqual(spaced);
    expect(tabbed.map((h) => [h.offset, h.line])).toEqual([[6, 3]]);
  });

  it("does not manufacture a heading inside fenced or indented code", () => {
    expect(parseHeadingsFromContent("```\n#\tnot a heading\n```\n")).toEqual([]);
    expect(parseHeadingsFromContent("~~~\n##\tnope\n~~~\n")).toEqual([]);
  });

  it("leaves a Tab that is not directly after the # run alone", () => {
    // Already worked before the fix; pinned so the rewrite cannot over-reach.
    expect(
      parseHeadingsFromContent("# \tBoth\n").map((h) => [h.text, h.id]),
    ).toEqual([["Both", "both"]]);
    // A Tab mid-text is content, and `slugBase` collapses it to one `-`.
    expect(
      parseHeadingsFromContent("#\tA\tB\n").map((h) => [h.text, h.id]),
    ).toEqual([["A\tB", "a-b"]]);
  });
});
