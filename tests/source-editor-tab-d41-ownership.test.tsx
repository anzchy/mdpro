/**
 * D41 WI-4 / WI-5 / WI-6 — who owns Tab in the mounted Source editor.
 *
 * Every (doc, selection, direction) maps to exactly one outcome:
 *  - fall-through iff no line of interest is a table line (fenced lines never
 *    are): the wrapper's `indentMore` / `indentLess` runs unchanged;
 *  - swallow: doc and selection unchanged, one `ui.table.tab_swallowed` log
 *    whose context is exactly `{controlId, key, reason, ranges}`. Reason
 *    precedence: multi-table > mixed-selection > delimiter-row >
 *    guard-refused > first-cell;
 *  - navigate: one cursor at the order-law target from the main head.
 *
 * Fall-through expectations come from the "indentMore oracle": the real
 * `indentMore` / `indentLess` on a bare `EditorState` with the same doc and
 * selection. Mounted `indentWithTab` always consumes the key, so cases assert
 * doc + ranges + mainIndex, never `handled`.
 *
 * Matrix `.claude/tdd-guardian/tests-20261002-D41.md`: C2-OWN-SWALLOW-DELIM /
 * -FIRST / -MIXED / -MULTI, C2-OWN-MULTI-RANGE (round 2), C2-OWN-FENCE-F,
 * C2-OWN-G (as rewritten by the "WI-0 finding" section), C2-OWN-FALL,
 * C2-OWN-NAV-RANGE, C2-LOG-1..4, C2-OBS-ESC. Mocked boundaries:
 * `@tauri-apps/api/core` / `event` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import type { EditorView } from "@codemirror/view";
import { loggingService } from "../src/services/loggingService";
import { D12_FIXTURES } from "./support/tableSpanOracle";
import { completeTree, indentOracle, swallowContexts, type Sel } from "./support/tabOwnershipOracle";
import {
  mountEditor,
  placeCursor,
  press,
  seedStores,
  select,
  teardownEditor,
} from "./support/mountSourceEditor";

const { T3, P2 } = D12_FIXTURES;
const D = "intro\n\n" + T3 + "\noutro\n";
const D2 = T3 + "\n" + P2;
const D3 = "```\nx\n```\n" + T3;
const F = "```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n";
const G = "intro\n\np | q\n| a | b |\n| - | - |\n| 1 | 2 |\n";
const H2 = "  | a | b | c |\n" + T3.slice(14);

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  seedStores();
  logSpy = vi.spyOn(loggingService, "logEventSync");
});
afterEach(teardownEditor);

function mountWith(doc: string, sel: Sel): EditorView {
  const view = mountEditor(doc);
  if (doc.includes("```")) completeTree(view);
  select(view, sel.ranges, sel.main);
  logSpy.mockClear();
  return view;
}

const full = (ranges: Sel["ranges"]) => ranges.map((r) => ({ anchor: r.anchor, head: r.head ?? r.anchor }));

/** Press and assert a swallow: state unchanged, exactly one log with this reason. */
function expectSwallow(doc: string, sel: Sel, shift: boolean, reason: string): void {
  const view = mountWith(doc, sel);
  const out = press(view, shift);
  expect({ doc: out.doc, ranges: out.ranges, mainIndex: out.mainIndex }).toEqual({
    doc,
    ranges: full(sel.ranges),
    mainIndex: sel.main,
  });
  expect(swallowContexts(logSpy)).toEqual([
    { controlId: "source.tab_nav", key: shift ? "Shift-Tab" : "Tab", reason, ranges: full(sel.ranges) },
  ]);
  teardownEditor();
  seedStores();
}

/** Press and assert a fall-through: the indentMore / indentLess oracle state, no swallow log. */
function expectFallThrough(doc: string, sel: Sel, shift: boolean): void {
  const view = mountWith(doc, sel);
  const out = press(view, shift);
  expect({ doc: out.doc, ranges: out.ranges, mainIndex: out.mainIndex }).toEqual(
    indentOracle(doc, sel, shift),
  );
  expect(swallowContexts(logSpy)).toEqual([]);
  teardownEditor();
  seedStores();
}

const cur = (...hs: number[]) => hs.map((h) => ({ anchor: h }));

describe("D41 WI-4 — swallow cases", () => {
  it.each([false, true])("C2-OWN-SWALLOW-DELIM / LOG-2: delimiter row swallows (shift=%s)", (shift) => {
    expectSwallow(T3, { ranges: cur(16), main: 0 }, shift, "delimiter-row");
  });

  it("C2-OWN-SWALLOW-FIRST / LOG-3: Shift-Tab at the first header cell swallows (T3, H2)", () => {
    expectSwallow(T3, { ranges: cur(2), main: 0 }, true, "first-cell");
    expectSwallow(H2, { ranges: cur(4), main: 0 }, true, "first-cell");
  });

  it.each([
    ["(a) prose → cell (LOG-1)", D, { ranges: [{ anchor: 2, head: 9 }], main: 0 }],
    ["(b) cell → prose", D, { ranges: [{ anchor: 9, head: 66 }], main: 0 }],
    ["(c) cursors [9, 2]", D, { ranges: cur(2, 9), main: 1 }],
    ["(d) cursors [2, 9]", D, { ranges: cur(2, 9), main: 0 }],
    ["(e) prose → prose across the table", D, { ranges: [{ anchor: 2, head: 66 }], main: 0 }],
    ["(D3) fence → table", D3, { ranges: [{ anchor: 4, head: 12 }], main: 0 }],
  ] as const)("C2-OWN-SWALLOW-MIXED %s: mixed-selection", (_n, doc, sel) => {
    for (const shift of [false, true]) expectSwallow(doc, sel as Sel, shift, "mixed-selection");
  });

  it("C2-OWN-SWALLOW-MULTI / LOG-4: cursors in two tables swallow as multi-table", () => {
    expectSwallow(D2, { ranges: cur(2, 59), main: 0 }, false, "multi-table");
  });

  it("C2-LOG-4(b): two tables plus a prose cursor is still multi-table", () => {
    expectSwallow(D2, { ranges: cur(2, 56, 59), main: 0 }, false, "multi-table");
  });

  it.each([
    ["{2 → 59}", 2, 59],
    ["{59 → 2}", 59, 2],
  ] as const)("C2-OWN-MULTI-RANGE %s: one range across two tables is multi-table", (_n, anchor, head) => {
    for (const shift of [false, true]) {
      expectSwallow(D2, { ranges: [{ anchor, head }], main: 0 }, shift, "multi-table");
    }
  });
});

describe("D41 WI-4 — fall-through cases", () => {
  it.each([
    ["(a) {4 → 26}", 4, 26],
    ["(b) {26 → 4}", 26, 4],
  ] as const)("C2-OWN-FENCE-F %s: fenced table text falls through", (_n, anchor, head) => {
    for (const shift of [false, true]) expectFallThrough(F, { ranges: [{ anchor, head }], main: 0 }, shift);
    expect(indentOracle(F, { ranges: [{ anchor: 4, head: 26 }], main: 0 }, false).doc).toBe(
      "```\n    | a | b |\n    | - | - |\n    | 1 | 2 |\n```\n",
    );
  });

  it("C2-OWN-G (WI-0 finding): a table under a paragraph line is not a table to Tab", () => {
    for (const shift of [false, true]) expectFallThrough(G, { ranges: [{ anchor: 35, head: 2 }], main: 0 }, shift);
    expectFallThrough(G, { ranges: cur(14), main: 0 }, false);
    expectFallThrough(G, { ranges: cur(9), main: 0 }, false);
    expect(indentOracle(G, { ranges: cur(9), main: 0 }, false)).toEqual({
      doc: "intro\n\n    p | q\n| a | b |\n| - | - |\n| 1 | 2 |\n",
      ranges: [{ anchor: 13, head: 13 }],
      mainIndex: 0,
    });
  });

  it("C2-OWN-FALL: prose, the line after a table, and prose-only cursors indent", () => {
    expectFallThrough("Just prose.\n", { ranges: cur(5), main: 0 }, false);
    expect(indentOracle("Just prose.\n", { ranges: cur(5), main: 0 }, false).doc).toBe("    Just prose.\n");
    expectFallThrough(T3, { ranges: cur(56), main: 0 }, false);
    expect(indentOracle(T3, { ranges: cur(56), main: 0 }, false).doc).toBe(T3 + "    ");
    expectFallThrough(D, { ranges: cur(2, 66), main: 0 }, false);
    expect(indentOracle(D, { ranges: cur(2, 66), main: 0 }, false)).toEqual({
      doc: "    intro\n\n" + T3 + "\n    outro\n",
      ranges: [{ anchor: 6, head: 6 }, { anchor: 74, head: 74 }],
      mainIndex: 0,
    });
  });
});

describe("D41 WI-4 — navigate", () => {
  it("C2-OWN-NAV-RANGE: a range inside one table navigates from the head and collapses", () => {
    const view = mountWith(T3, { ranges: [{ anchor: 2, head: 34 }], main: 0 });
    const out = press(view, true);
    expect({ doc: out.doc, ranges: out.ranges }).toEqual({ doc: T3, ranges: [{ anchor: 29, head: 29 }] });
    expect(swallowContexts(logSpy)).toEqual([]);
  });
});

describe("D41 WI-6 — OBS-ESC (observation only)", () => {
  // Observed on commit 1 (a21d5da) before any D41 production edit: CodeMirror's
  // Escape-then-Tab focus escape hatch releases Tab — it is not prevented and
  // no keymap runs (head stays 2). The control press shows the DOM path itself
  // works: a plain Tab is consumed and navigates.
  const key = (k: string, code: number) =>
    new KeyboardEvent("keydown", { key: k, keyCode: code, bubbles: true, cancelable: true });

  it("C2-OBS-ESC: Escape then Tab on the content DOM releases Tab", () => {
    const view = mountEditor(T3);
    placeCursor(view, 2);
    const control = key("Tab", 9);
    view.contentDOM.dispatchEvent(control);
    expect({ prevented: control.defaultPrevented, head: view.state.selection.main.head }).toEqual({
      prevented: true,
      head: 5,
    });
    placeCursor(view, 2);
    const esc = key("Escape", 27);
    const tab = key("Tab", 9);
    expect([esc.keyCode, tab.keyCode]).toEqual([27, 9]);
    view.contentDOM.dispatchEvent(esc);
    view.contentDOM.dispatchEvent(tab);
    expect({
      escPrevented: esc.defaultPrevented,
      tabPrevented: tab.defaultPrevented,
      head: view.state.selection.main.head,
      doc: view.state.doc.toString(),
    }).toEqual({ escPrevented: false, tabPrevented: false, head: 2, doc: T3 });
  });
});
