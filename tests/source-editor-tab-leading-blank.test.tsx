/**
 * D41 commit 1 — the user-visible half of the `parseRowCells` leading-blank fix
 * (WI-1), driven through the REAL mounted Source editor.
 *
 * Plan: `.claude/tdd-guardian/plan-20261002-D41.md`; matrix:
 * `.claude/tdd-guardian/tests-20261002-D41.md` cases C1-HARNESS,
 * C1-MNT-LEAD-TAB, C1-MNT-LEAD-SHIFT, C1-MNT-T3A.
 *
 * On af51749 `parseRowCells` drops EVERY blank cell it sees while only one cell
 * has been collected, not just the blank edge segment before the first `|`.
 * `| | x |` therefore parses with x in column 0, and an appended `|  |  |  |`
 * row parses as three zero-width cells after the trailing pipe, so a caret in
 * that row is in no cell and Tab falls through to `indentWithTab`.
 *
 * The wrapper's `indentWithTab` always returns true, so these cases assert the
 * doc and the head, never `handled`.
 *
 * Mocked boundaries: `@tauri-apps/api/core` and `@tauri-apps/api/event` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { getIndentUnit, indentUnit } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import {
  INDENT,
  mountEditor,
  placeCursor,
  press,
  seedStores,
  select,
  snapshot,
  teardownEditor,
} from "./support/mountSourceEditor";

// Hand-derived fixtures (matrix fixture block); never computed by the parser.
const T3 = "| a | b | c |\n| - | - | - |\n| d | e | f |\n| g | h | i |\n";
const T3A = T3 + "|  |  |  |\n";
/** header [1,5) [6,10); row 1 (fixed) c0 [23,24) "", c1 [25,28) "x". */
const LEAD = "| h1 | h2 |\n| - | - |\n| | x |\n";

beforeEach(() => {
  seedStores();
});

afterEach(() => {
  teardownEditor();
});

describe("C1-HARNESS mounted preconditions", () => {
  it("indent unit 4, editable, doc === input, and select() builds a multi-range selection", () => {
    const view = mountEditor(T3);
    expect(getIndentUnit(view.state)).toBe(4);
    expect(view.state.facet(indentUnit)).toBe(INDENT);
    expect(view.state.facet(EditorView.editable)).toBe(true);
    expect(view.state.doc.toString()).toBe(T3);
    select(view, [{ anchor: 2, head: 9 }, { anchor: 30 }], 1);
    const s = snapshot(view);
    expect(s.ranges).toEqual([
      { anchor: 2, head: 9 },
      { anchor: 30, head: 30 },
    ]);
    expect(s.mainIndex).toBe(1);
  });
});

describe("C1-MNT-LEAD blank leading cell in a body row", () => {
  it("C1-MNT-LEAD-TAB: Tab from the blank cell (23) moves to x (25), doc unchanged", () => {
    const view = mountEditor(LEAD);
    placeCursor(view, 23);
    const out = press(view, false);
    expect({ doc: out.doc, head: out.head }).toEqual({ doc: LEAD, head: 25 });
  });

  it("C1-MNT-LEAD-SHIFT: Shift-Tab from x (26) lands on the blank cell (23), not the header", () => {
    const view = mountEditor(LEAD);
    placeCursor(view, 26);
    const out = press(view, true);
    expect({ doc: out.doc, head: out.head }).toEqual({ doc: LEAD, head: 23 });
  });
});

describe("C1-MNT-T3A appended all-blank row", () => {
  it("(a) second Tab in the appended row moves 58 → 60, does not indent", () => {
    const view = mountEditor(T3A);
    placeCursor(view, 58);
    const out = press(view, false);
    expect({ doc: out.doc, head: out.head }).toEqual({ doc: T3A, head: 60 });
  });

  it("(b) Shift-Tab from the appended row's first cell moves 58 → 51 (cell i)", () => {
    const view = mountEditor(T3A);
    placeCursor(view, 58);
    const out = press(view, true);
    expect({ doc: out.doc, head: out.head }).toEqual({ doc: T3A, head: 51 });
  });
});
