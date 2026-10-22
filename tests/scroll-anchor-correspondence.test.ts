/**
 * @module scroll-anchor-correspondence.test
 * Purpose: the drift detector for WI-8's block tier. Mounts a REAL Milkdown
 * (commonmark + gfm, the presets MilkdownEditor.tsx uses) in jsdom and asserts
 * that the top-level ProseMirror children correspond 1:1 with
 * `enumerateSourceBlocks`, and the rendered headings with
 * `enumerateSourceHeadings`. When a Milkdown/remark upgrade changes a
 * transform, this file fails before a user sees a wrong scroll position.
 *
 * The second half drives the Milkdown adapter against that real view with
 * stubbed geometry (jsdom has no layout).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync: vi.fn(), generateActionId: vi.fn(() => "id") },
}));

import { defaultValueCtx, Editor, editorViewCtx, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  anchorFromSourceLine,
  buildSourceModel,
  enumerateSourceBlocks,
  enumerateSourceHeadings,
  type ScrollAnchor,
} from "../src/utils/scrollAnchor/anchor";
import {
  captureMilkdownScrollAnchor,
  resolveMilkdownScroller,
  restoreMilkdownScrollAnchor,
} from "../src/utils/scrollAnchor/milkdown";
import { collectionCases } from "./support/collectionCases";

const mounted: Editor[] = [];

async function mount(markdown: string): Promise<EditorView> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmark)
    .use(gfm)
    .create();
  mounted.push(editor);
  return editor.action((ctx) => ctx.get(editorViewCtx));
}

afterEach(async () => {
  while (mounted.length) await mounted.pop()!.destroy();
  document.body.innerHTML = "";
});

const FIXTURES: Record<string, string> = {
  frontmatter: "---\ntitle: x\n---\n\n# H\n\npara\n",
  frontmatterEmptyBody: "---\n---\n\np\n",
  linkDefinition: "para [a]\n\n[a]: http://x\n\n# H\n",
  consecutiveDefinitions: "p [a] [b]\n\n[a]: http://x\n[b]: http://y\n\nq\n",
  definitionFirst: "[a]: http://x\n# H\n",
  definitionInQuote: "> [a]: http://x\n\np\n",
  footnote: "text[^1]\n\n[^1]: note\n",
  twoFootnotes: "a[^1] b[^2]\n\n[^1]: x\n[^2]: y\n",
  brBlocks: "para\n\n<br>\n\nnext\n\n<br />\n",
  htmlComment: "a\n\n<!-- c -->\n\nb\n",
  htmlBlock: "a\n\n<div>x</div>\n\nb\n",
  details: "<details>\n<summary>s</summary>\n\nbody\n\n</details>\n\np\n",
  processingInstruction: "<?php x ?>\n\np\n",
  tableInterruptsParagraph: "para\n| a | b |\n|---|---|\n| 1 | 2 |\n",
  headingThenTable: "# H\n| a |\n|---|\n| 1 |\n",
  displayMath: "a\n\n$$\nx\n$$\n\nb\n",
  looseList: "- a\n\n- b\n\n- c\n",
  taskList: "- [ ] a\n- [x] b\n",
  setext: "Title\n=====\n\npara\n",
  thematicBreak: "a\n\n***\n\nb\n",
  indentedCode: "a\n\n    code\n\nb\n",
  tildeFence: "~~~js\nx\n~~~\n",
  unclosedFence: "```\nx\n",
  image: "![x](y.png)\n\npara\n",
  nestedHeadings: "> # Q\n\n- ## L\n",
  tabHeading: "#\tTitle\n\npara\n",
  crlf: "# A\r\n\r\npara\r\n\r\n```\r\nx\r\n```\r\n",
  cjk: "# 标题\n\n中文段落。\n\n| 列 | 值 |\n|---|---|\n| 甲 | 乙 |\n",
  duplicateSetup: "# Guide\n\n## Setup\n\na\n\n## Setup\n\nb\n\n## Setup\n\nc\n",
  manyBlankLines: "p\n\n\n\n\nq\n",
};

describe("Milkdown ⇄ Lezer block correspondence", () => {
  for (const [name, markdown] of collectionCases("tests/scroll-anchor-correspondence.test.ts:94", Object.entries(FIXTURES))) {
    it(`${name}: top-level block count and heading count agree`, async () => {
      const view = await mount(markdown);
      expect(view.state.doc.childCount).toBe(enumerateSourceBlocks(markdown).length);
      expect(view.dom.querySelectorAll("h1, h2, h3, h4, h5, h6").length).toBe(
        enumerateSourceHeadings(markdown).length,
      );
    });
  }

  // Known divergences: Milkdown always holds at least one (empty) paragraph.
  // Pinned so they stay harmless — the source side produces NO anchor for them.
  for (const [name, markdown] of [
    ["empty document", ""],
    ["definition-only document", "[a]: http://x\n"],
  ] as const) {
    it(`${name}: PM has 1 block, source has 0, and no anchor is produced`, async () => {
      const view = await mount(markdown);
      expect(view.state.doc.childCount).toBe(1);
      expect(enumerateSourceBlocks(markdown)).toEqual([]);
      expect(anchorFromSourceLine(buildSourceModel(markdown), 1, "d")).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// Adapter against a real view, with stubbed geometry
// ---------------------------------------------------------------------------

const BLOCK_PITCH = 100; // each block starts 100px below the previous
const BLOCK_HEIGHT = 80; // leaving a 20px inter-block margin
const SCROLLER_HEIGHT = 600;
const ADAPTER_DOC = "# A\n\np1\n\n## B\n\np2\n\n## B\n\np3\n"; // 6 blocks, 3 headings

interface Rig {
  view: EditorView;
  scroller: HTMLElement;
  scrollTop: () => number;
  setScrollTop: (value: number) => void;
}

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 700, width: 700, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

async function rig(): Promise<Rig> {
  const view = await mount(ADAPTER_DOC);
  const scroller = resolveMilkdownScroller(view);
  if (!scroller) throw new Error("scroller not resolved");
  let scrollTop = 0;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => SCROLLER_HEIGHT });
  scroller.getBoundingClientRect = () => rect(0, SCROLLER_HEIGHT);
  const count = view.state.doc.childCount;
  view.dom.getBoundingClientRect = () => rect(-scrollTop, count * BLOCK_PITCH);
  let index = 0;
  view.state.doc.forEach((_node, offset) => {
    const i = index++;
    const dom = view.nodeDOM(offset) as HTMLElement;
    dom.getBoundingClientRect = () => rect(i * BLOCK_PITCH - scrollTop, BLOCK_HEIGHT);
  });
  return { view, scroller, scrollTop: () => scrollTop, setScrollTop: (v) => (scrollTop = v) };
}

describe("Milkdown adapter", () => {
  it("resolves the scroller as the `.milkdown` container around view.dom", async () => {
    const view = await mount("p\n");
    const scroller = resolveMilkdownScroller(view);
    expect(scroller?.classList.contains("milkdown")).toBe(true);
    expect(scroller).toBe(view.dom.parentElement);
  });

  it("captures block index and pixel fraction at the 40px probe", async () => {
    const { view, scroller, setScrollTop } = await rig();
    setScrollTop(230); // probe at content y 270 = block 2, 70/80 through it
    const anchor = captureMilkdownScrollAnchor(view, scroller, "d");
    expect(anchor?.documentId).toBe("d");
    expect(anchor?.block).toEqual({ blockIndex: 2, fraction: 0.875, blockCount: 6 });
    expect(anchor?.heading).toMatchObject({ headingOrdinal: 1, headingCount: 3 });
  });

  it("a probe in an inter-block margin resolves to the NEXT block at fraction 0", async () => {
    const { view, scroller, setScrollTop } = await rig();
    setScrollTop(250); // content y 290, inside block 2's 280-300 margin
    expect(captureMilkdownScrollAnchor(view, scroller, "d")?.block).toEqual({
      blockIndex: 3,
      fraction: 0,
      blockCount: 6,
    });
  });

  it("returns null for an unlaid-out scroller", async () => {
    const { view, scroller } = await rig();
    Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 0 });
    expect(captureMilkdownScrollAnchor(view, scroller, "d")).toBeNull();
  });

  it("never throws: a geometry read that throws yields null", async () => {
    const { view, scroller } = await rig();
    scroller.getBoundingClientRect = () => {
      throw new Error("detached");
    };
    expect(captureMilkdownScrollAnchor(view, scroller, "d")).toBeNull();
  });

  it("restores a block anchor so the target sits at the probe line", async () => {
    const { view, scroller, scrollTop } = await rig();
    const anchor: ScrollAnchor = {
      documentId: "d",
      block: { blockIndex: 2, fraction: 0.875, blockCount: 6 },
      heading: null,
    };
    expect(restoreMilkdownScrollAnchor(view, scroller, anchor)).toBe(true);
    expect(scrollTop()).toBe(230);
  });

  it("falls back to the heading tier when the block count disagrees", async () => {
    const { view, scroller, scrollTop } = await rig();
    const anchor: ScrollAnchor = {
      documentId: "d",
      block: { blockIndex: 2, fraction: 0.5, blockCount: 7 },
      heading: { headingOrdinal: 2, fraction: 0, headingCount: 3 },
    };
    expect(restoreMilkdownScrollAnchor(view, scroller, anchor)).toBe(true);
    expect(scrollTop()).toBe(4 * BLOCK_PITCH - 40); // third heading is block 4
  });

  it("drops the anchor (no scroll) when both tiers disagree", async () => {
    const { view, scroller, scrollTop, setScrollTop } = await rig();
    setScrollTop(10);
    const anchor: ScrollAnchor = {
      documentId: "d",
      block: { blockIndex: 2, fraction: 0.5, blockCount: 7 },
      heading: { headingOrdinal: 0, fraction: 0, headingCount: 9 },
    };
    expect(restoreMilkdownScrollAnchor(view, scroller, anchor)).toBe(false);
    expect(scrollTop()).toBe(10);
  });

  it("round-trips capture → restore to the same scrollTop", async () => {
    const { view, scroller, scrollTop, setScrollTop } = await rig();
    setScrollTop(333);
    const anchor = captureMilkdownScrollAnchor(view, scroller, "d")!;
    setScrollTop(0);
    restoreMilkdownScrollAnchor(view, scroller, anchor);
    expect(scrollTop()).toBeCloseTo(333, 6);
  });
});
