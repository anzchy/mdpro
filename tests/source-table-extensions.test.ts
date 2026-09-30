/**
 * WI-4 (plan-20260922-113723): the four Source-mode CodeMirror table
 * extensions are installed through one pure helper, `sourceTableExtensions`,
 * and are withheld together — all four or none — for a document whose Source
 * table verdict is "withheld" (ADR-0022).
 *
 * X1-X6 exercise the helper through real `EditorState` / `EditorView`
 * collaborators. X4 counts table parses through a PASSTHROUGH spy on
 * `parseTableAtOffset` (precedent: tests/table-write-guard.test.ts:54-57):
 * nothing is replaced, the real return value is forwarded unaltered.
 *
 * C18 is a source-text Gate on `Editor.tsx`, which has no render harness. The
 * behavioural check for Editor's withheld boolean is X7
 * (tests/use-source-tables-withheld.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { EditorSelection, EditorState, StateEffect, type Extension } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { diagnosticCount, forceLinting } from "@codemirror/lint";
import { history, redoDepth, undo, undoDepth } from "@codemirror/commands";

vi.mock("../src/utils/tableParser/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/parse")>();
  return { ...actual, parseTableAtOffset: vi.fn(actual.parseTableAtOffset) };
});
vi.mock("../src/utils/tableParser/locate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/locate")>();
  return { ...actual, locateTableAtOffset: vi.fn(actual.locateTableAtOffset) };
});

const { parseTableAtOffset } = await import("../src/utils/tableParser/parse");
const { locateTableAtOffset } = await import("../src/utils/tableParser/locate");
const { getTableContext } = await import("../src/plugins/codemirror/sourceTableDetection");
const { sourceTableTabKeymap } = await import("../src/plugins/codemirror/sourceTableTabNav");
const { sourceTableExtensions } = await import(
  "../src/plugins/codemirror/sourceTableExtensions"
);

const parseSpy = vi.mocked(parseTableAtOffset);
const locateSpy = vi.mocked(locateTableAtOffset);

const SIMPLE_MD = "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n";
const RAGGED = "| a | b |\n| - | - |\n| 1 |\n| 2 | 3 | 4 |\n";

/** A sentinel keymap: identity is what X5 checks. */
const K: Extension = keymap.of([]);

function stateWith(doc: string, anchor: number, extensions: Extension[]): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(anchor),
    extensions,
  });
}

function viewWith(doc: string, anchor: number, extensions: Extension[]): EditorView {
  return new EditorView({ state: stateWith(doc, anchor, extensions) });
}

beforeEach(() => {
  parseSpy.mockClear();
  locateSpy.mockClear();
});

describe("WI-4: sourceTableExtensions", () => {
  it("X1: withheld returns nothing", () => {
    expect(sourceTableExtensions({ withheld: true, tabKeymap: K })).toEqual([]);
  });

  it("X2: the detection field is absent when withheld and exact when not", () => {
    const withheld = stateWith(SIMPLE_MD, 2, [
      markdown(),
      ...sourceTableExtensions({ withheld: true, tabKeymap: K }),
    ]);
    expect(getTableContext(withheld)).toBeNull();

    const allowed = stateWith(SIMPLE_MD, 2, [
      markdown(),
      ...sourceTableExtensions({ withheld: false, tabKeymap: K }),
    ]);
    const ctx = getTableContext(allowed);
    expect(ctx).not.toBeNull();
    expect(ctx!.colCount).toBe(3);
    expect(ctx!.rowCount).toBe(3);
  });

  it("X3: Tab falls through when withheld and navigates when not", () => {
    const tab = () => new KeyboardEvent("keydown", { key: "Tab" });

    const withheld = viewWith(SIMPLE_MD, 2, [
      markdown(),
      ...sourceTableExtensions({ withheld: true, tabKeymap: keymap.of(sourceTableTabKeymap) }),
    ]);
    expect(runScopeHandlers(withheld, tab(), "editor")).toBe(false);
    expect(withheld.state.selection.main.head).toBe(2);
    expect(withheld.state.doc.toString()).toBe(SIMPLE_MD);
    withheld.destroy();

    const allowed = viewWith(SIMPLE_MD, 2, [
      markdown(),
      ...sourceTableExtensions({ withheld: false, tabKeymap: keymap.of(sourceTableTabKeymap) }),
    ]);
    expect(runScopeHandlers(allowed, tab(), "editor")).toBe(true);
    const head = allowed.state.selection.main.head;
    expect(head).toBeGreaterThanOrEqual(5);
    expect(head).toBeLessThanOrEqual(7);
    expect(allowed.state.doc.toString()).toBe(SIMPLE_MD);
    allowed.destroy();
  });

  it("X4: selection moves re-locate and re-parse nothing, for 20 and 200 moves", () => {
    const SIMPLE_LEN = 56;
    const run = (withheld: boolean, n: number) => {
      let state = stateWith(SIMPLE_MD, 0, [
        markdown(),
        ...sourceTableExtensions({ withheld, tabKeymap: K }),
      ]);
      parseSpy.mockClear();
      locateSpy.mockClear();
      for (let p = 1; p <= n; p++) {
        state = state.update({ selection: { anchor: 1 + ((p - 1) % SIMPLE_LEN) } }).state;
      }
      return { state, parses: parseSpy.mock.calls.length, locates: locateSpy.mock.calls.length };
    };

    for (const n of [20, 200]) {
      const withheld = run(true, n);
      expect(getTableContext(withheld.state)).toBeNull();
      expect({ parses: withheld.parses, locates: withheld.locates }).toEqual({ parses: 0, locates: 0 });

      // ADR-0043 D1/D4: the field holds a span, and a selection-only move
      // whose raw line stays in it reuses the span. The old "exactly 20"
      // parses pinned D12; every offset of SIMPLE_MD is inside the table.
      const allowed = run(false, n);
      expect(getTableContext(allowed.state)).toEqual({
        start: 0,
        end: 55,
        headerLine: 0,
        lastLine: 3,
        rowCount: 3,
        colCount: 3,
        alignments: [null, null, null],
        delimiterIsCandidate: true,
      });
      expect({ n, parses: allowed.parses, locates: allowed.locates }).toEqual({ n, parses: 0, locates: 0 });
    }
  });

  it("X5: order and identity when not withheld", () => {
    const result = sourceTableExtensions({ withheld: false, tabKeymap: K });
    expect(result).toHaveLength(4);
    expect(result[1]).toBe(K);

    // result[0] is the detection extension.
    expect(getTableContext(stateWith(SIMPLE_MD, 2, [result[0]]))).not.toBeNull();

    // result[2] is the cell highlight (needs detection to have a context).
    const view = viewWith(SIMPLE_MD, 2, [result[0], result[2]]);
    expect(view.contentDOM.querySelector(".cm-table-active-cell")).not.toBeNull();
    view.destroy();
    const noHighlight = viewWith(SIMPLE_MD, 2, [result[0]]);
    expect(noHighlight.contentDOM.querySelector(".cm-table-active-cell")).toBeNull();
    noHighlight.destroy();
    // result[3] is the linter: X6.
  });

  it("X6: no column-count diagnostics when withheld, exactly 2 when not", async () => {
    const count = async (withheld: boolean) => {
      const view = viewWith(RAGGED, 0, [
        markdown(),
        ...sourceTableExtensions({ withheld, tabKeymap: K }),
      ]);
      forceLinting(view);
      await Promise.resolve();
      await Promise.resolve();
      const n = diagnosticCount(view.state);
      view.destroy();
      return n;
    };

    expect(await count(true)).toBe(0);
    expect(await count(false)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// C18 — Editor.tsx wiring (Gate; Editor has no render harness).
// ---------------------------------------------------------------------------
function readSrc(relativeToTestsDir: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("testPath unavailable");
  return fs.readFileSync(path.resolve(path.dirname(testPath), relativeToTestsDir), "utf-8");
}

describe("WI-4: Editor.tsx installs the table extensions through the helper", () => {
  it("C18: one helper call, no bare extension calls, the hook boolean in the memo deps", () => {
    const src = readSrc("../src/components/Editor/Editor.tsx");

    expect(src.match(/sourceTableExtensions\(/g) ?? []).toHaveLength(1);
    expect(src).not.toMatch(/\btableDetectionExtension\(\)/);
    expect(src).not.toMatch(/\bsourceTableCellHighlightExtension\(\)/);
    expect(src).not.toMatch(/\btableColumnCountLinter\(\)/);

    // The withheld boolean comes from the subscribing hook, exactly once.
    expect(src.match(/useSourceTablesWithheld\(/g) ?? []).toHaveLength(1);
    const assigned = src.match(/const\s+(\w+)\s*=\s*useSourceTablesWithheld\(\s*\)/);
    expect(assigned).not.toBeNull();
    const name = assigned![1];

    // The extensions memo's deps change only by that boolean.
    const memoIdx = src.indexOf("const extensions = useMemo(");
    expect(memoIdx).toBeGreaterThan(-1);
    const deps =
      "[pluginEventExtension, pluginExtensions, undoRedoKeymap, sourceTableTabKeymapExt, viewModeKeymap, " +
      `${name}]`;
    const depsIdx = src.indexOf(deps, memoIdx);
    expect(depsIdx).toBeGreaterThan(memoIdx);
    // ...and it is the extensions memo's own deps, not a later hook's.
    expect(src.slice(memoIdx, depsIdx).match(/useMemo\(/g) ?? []).toHaveLength(1);

    // Absence pin (adversary Gap 2): no non-subscribing read inlined back.
    expect(src.replace(/\s+/g, "")).not.toContain(
      "isSourceTablesWithheld(useEditorStore.getState()",
    );
  });
});

describe("X8: withholding reconfigures without dropping undo history (review note)", () => {
  // Editor.tsx flips the extensions memo when the verdict lands; @uiw/react-codemirror
  // applies it as StateEffect.reconfigure. The history field is the same extension
  // instance on both sides, so its value must survive the flip. Characterises
  // CodeMirror semantics the withhold relies on; passes without new source code.
  it("keeps undoDepth across the withheld flip and undo still restores the text", () => {
    const hist = history();
    const base = (withheld: boolean): Extension[] => [
      hist,
      markdown(),
      ...sourceTableExtensions({ withheld, tabKeymap: keymap.of([]) }),
    ];
    const view = new EditorView({ state: EditorState.create({ doc: SIMPLE_MD, extensions: base(false) }) });
    try {
      view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
      expect(undoDepth(view.state)).toBe(1);

      view.dispatch({ effects: StateEffect.reconfigure.of(base(true)) });
      expect(undoDepth(view.state)).toBe(1);
      expect(view.state.doc.toString()).toBe(`x${SIMPLE_MD}`);

      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(SIMPLE_MD);
      expect(redoDepth(view.state)).toBe(1);
    } finally {
      view.destroy();
    }
  });
});
