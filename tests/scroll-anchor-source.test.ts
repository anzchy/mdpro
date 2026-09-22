/**
 * @module scroll-anchor-source.test
 * Purpose: pin the CodeMirror adapter of WI-8's scroll anchor —
 * `captureSourceScrollAnchor` reads the spy probe line (the same 40px sample
 * the TOC highlight uses) and `restoreSourceScrollAnchor` consumes the slot and
 * dispatches ONE `scrollIntoView` that puts the target line back at the probe.
 *
 * `readSpyLineRange` is mocked: it is a layout read, and jsdom has no layout.
 * Its own contract is pinned by the codemirrorViewportLine tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync: vi.fn(), generateActionId: () => "id" },
}));
const readSpyLineRange = vi.fn();
vi.mock("../src/utils/codemirrorViewportLine", async (importActual) => ({
  ...(await importActual<typeof import("../src/utils/codemirrorViewportLine")>()),
  readSpyLineRange: (...args: unknown[]) => readSpyLineRange(...args),
}));

import { EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  captureSourceScrollAnchor,
  restoreSourceScrollAnchor,
  sourceModelForRestore,
} from "../src/utils/scrollAnchor/source";
import {
  anchorFromSourceLine,
  buildSourceModel,
  getPendingScrollAnchor,
  setPendingScrollAnchor,
  type ScrollAnchor,
} from "../src/utils/scrollAnchor/anchor";
import { SPY_ANCHOR_OFFSET_PX } from "../src/utils/codemirrorViewportLine";
import { LARGE_DOCUMENT_STRUCTURE_THRESHOLD } from "../src/utils/largeDocumentGuard";
import { useTOCStore } from "../src/stores/tocStore";
import type { TOCEntry } from "../src/types/toc";

const DOC = "doc-s";
const CONTENT = [
  "# Guide", // 1
  "", // 2
  "## Setup", // 3
  "a", // 4
  "b", // 5
  "", // 6
  "## Setup", // 7
  "c", // 8
  "d", // 9
  "e", // 10
].join("\n");

// Destroyed after each test: a dispatched scroll target schedules CodeMirror's
// measure pass, which calls Range.getClientRects — absent in jsdom.
const views: EditorView[] = [];
function makeView(doc: string): EditorView {
  const view = new EditorView({ state: EditorState.create({ doc }), parent: document.body });
  views.push(view);
  return view;
}

afterEach(() => {
  while (views.length) views.pop()!.destroy();
});

interface ScrollTargetLike {
  range: { head: number };
  y: string;
  yMargin: number;
}

function scrollTargetOf(spec: TransactionSpec): ScrollTargetLike {
  const effects = Array.isArray(spec.effects) ? spec.effects : [spec.effects];
  expect(effects).toHaveLength(1);
  return (effects[0] as { value: ScrollTargetLike }).value;
}

beforeEach(() => {
  readSpyLineRange.mockReset();
  setPendingScrollAnchor(null);
  useTOCStore.setState({ entries: [], documentId: null });
});

describe("captureSourceScrollAnchor", () => {
  it("anchors at the spy probe's top line", () => {
    const view = makeView(CONTENT);
    readSpyLineRange.mockReturnValue({ topLine: 8, bottomLine: 10, atScrollLimit: false });
    const anchor = captureSourceScrollAnchor(view, DOC);
    expect(anchor).toEqual(anchorFromSourceLine(buildSourceModel(CONTENT), 8, DOC));
    expect(anchor?.block?.blockIndex).toBe(4); // "c d e" paragraph
  });

  it("returns null when the probe has no usable sample", () => {
    readSpyLineRange.mockReturnValue(null);
    expect(captureSourceScrollAnchor(makeView(CONTENT), DOC)).toBeNull();
  });

  it("returns null for a document above the WYSIWYG threshold (no full parse on the toggle)", () => {
    const big = "x\n".repeat(LARGE_DOCUMENT_STRUCTURE_THRESHOLD + 10);
    readSpyLineRange.mockReturnValue({ topLine: 100, bottomLine: 120, atScrollLimit: false });
    expect(captureSourceScrollAnchor(makeView(big), DOC)).toBeNull();
  });
});

describe("restoreSourceScrollAnchor", () => {
  it("scrolls the anchored line to the probe offset, and consumes the slot", () => {
    const view = makeView(CONTENT);
    const dispatch = vi.spyOn(view, "dispatch");
    setPendingScrollAnchor(anchorFromSourceLine(buildSourceModel(CONTENT), 9, DOC));
    expect(restoreSourceScrollAnchor(view, DOC)).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const target = scrollTargetOf(dispatch.mock.calls[0][0] as TransactionSpec);
    expect(target.range.head).toBe(view.state.doc.line(9).from);
    expect(target.y).toBe("start");
    expect(target.yMargin).toBe(SPY_ANCHOR_OFFSET_PX);
    expect(getPendingScrollAnchor()).toBeNull();
  });

  it("does nothing for another document's anchor", () => {
    const view = makeView(CONTENT);
    const dispatch = vi.spyOn(view, "dispatch");
    setPendingScrollAnchor(anchorFromSourceLine(buildSourceModel(CONTENT), 9, "other"));
    expect(restoreSourceScrollAnchor(view, DOC)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("drops an anchor whose counts match neither tier (view stays at the top)", () => {
    const view = makeView(CONTENT);
    const dispatch = vi.spyOn(view, "dispatch");
    const anchor: ScrollAnchor = {
      documentId: DOC,
      block: { blockIndex: 1, fraction: 0, blockCount: 50 },
      heading: { headingOrdinal: 0, fraction: 0, headingCount: 50 },
    };
    setPendingScrollAnchor(anchor);
    expect(restoreSourceScrollAnchor(view, DOC)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("never throws", () => {
    const view = makeView(CONTENT);
    vi.spyOn(view, "dispatch").mockImplementation(() => {
      throw new Error("destroyed");
    });
    setPendingScrollAnchor(anchorFromSourceLine(buildSourceModel(CONTENT), 9, DOC));
    expect(() => restoreSourceScrollAnchor(view, DOC)).not.toThrow();
  });
});

function entry(lineNumber: number): TOCEntry {
  return {
    key: `k${lineNumber}` as TOCEntry["key"],
    anchorSlug: `s${lineNumber}` as TOCEntry["anchorSlug"],
    level: 2,
    text: "H",
    lineNumber,
    offset: 0,
    children: [],
  };
}

describe("sourceModelForRestore", () => {
  it("below the threshold: the full block + heading model", () => {
    expect(sourceModelForRestore(CONTENT, DOC)).toEqual(buildSourceModel(CONTENT));
  });

  it("above the threshold: no block tier; headings = frontmatter headings + tocStore lines", () => {
    const body = "x\n".repeat(LARGE_DOCUMENT_STRUCTURE_THRESHOLD + 10);
    const content = "---\ntitle: t\n---\n" + body;
    useTOCStore.setState({ documentId: DOC, entries: [entry(9), entry(400)] });
    const model = sourceModelForRestore(content, DOC);
    expect(model.blocks).toBeNull();
    expect(model.headingLines).toEqual([2, 9, 400]);
    expect(model.lineCount).toBe(content.split("\n").length);
  });

  it("above the threshold with another document's TOC: no heading tier at all", () => {
    const content = "# H\n" + "x\n".repeat(LARGE_DOCUMENT_STRUCTURE_THRESHOLD + 10);
    useTOCStore.setState({ documentId: "other", entries: [entry(1)] });
    expect(sourceModelForRestore(content, DOC).headingLines).toEqual([]);
  });
});
