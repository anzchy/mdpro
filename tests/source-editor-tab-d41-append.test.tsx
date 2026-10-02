/**
 * D41 WI-3 — Tab on the last cell appends EXACTLY one blank row, in one
 * transaction, and collapses the selection to one cursor in its first cell.
 * Before D41 the append also wrote a trailing `"\n"` (an extra blank line
 * after every append — defect b).
 *
 * Laws (matrix `.claude/tdd-guardian/tests-20261002-D41.md`, WI-3):
 *  - Conservation: `after == doc.slice(0, end) + "\n" + "|" + "  |"×cc + doc.slice(end)`.
 *  - Round-trip: one undo restores the original exactly.
 *  - Collapse: one cursor at `end + 3`, whatever ranges existed before.
 *
 * Cases: C2-APPEND-1..4, -MULTI, -CONS, -UNDO, -ONE-TX, -CRLF. Mounted real
 * Editor; mocked boundaries `@tauri-apps/api/core` / `event` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { render } from "@testing-library/react";
import { undo } from "@codemirror/commands";
import type { Transaction, TransactionSpec } from "@codemirror/state";
import { Editor } from "../src/components/Editor/Editor";
import { useEditorStore } from "../src/stores/editorStore";
import { loggingService } from "../src/services/loggingService";
import { serializeRows } from "../src/utils/tableParser";
import { D12_FIXTURES } from "./support/tableSpanOracle";
import {
  mountEditor,
  placeCursor,
  press,
  resetDoc,
  seedStores,
  select,
  teardownEditor,
} from "./support/mountSourceEditor";

const { T3, P2 } = D12_FIXTURES;
const D = "intro\n\n" + T3 + "\noutro\n";
const P2_NO_EOL = "| a | b |\n| - | - |\n| 1 | 2 |";
const ROW2 = "|  |  |";

/** APPEND-1..4: [input, expected after Tab at caret 26]. All end at offset 29. */
const TAILS: ReadonlyArray<readonly [string, string, string]> = [
  ["(1) blank line + prose after", P2 + "\nafter\n", P2 + ROW2 + "\n\nafter\n"],
  ["(2) prose directly after (AFTER_TAIL)", P2 + "after\n", P2 + ROW2 + "\nafter\n"],
  ["(3) EOF with newline", P2, P2 + ROW2 + "\n"],
  ["(4) EOF without newline", P2_NO_EOL, P2_NO_EOL + "\n" + ROW2],
];

beforeEach(() => seedStores());
afterEach(teardownEditor);

describe("D41 WI-3 — exact append text", () => {
  it.each(TAILS)("C2-APPEND %s: one row, no extra blank line, head 32", (_n, input, want) => {
    const view = mountEditor(input);
    placeCursor(view, 26);
    const out = press(view, false);
    expect({ doc: out.doc, head: out.head }).toEqual({ doc: want, head: 32 });
  });

  it("C2-APPEND-MULTI: a multi-cursor append collapses to one cursor in the new row", () => {
    const view = mountEditor(D);
    const spy = vi.spyOn(loggingService, "logEventSync");
    select(view, [{ anchor: 9 }, { anchor: 59 }], 1);
    const out = press(view, false);
    expect({ doc: out.doc, ranges: out.ranges, mainIndex: out.mainIndex }).toEqual({
      doc: D.slice(0, 62) + "\n|  |  |  |" + D.slice(62),
      ranges: [{ anchor: 65, head: 65 }],
      mainIndex: 0,
    });
    expect(D.slice(0, 62) + "\n|  |  |  |" + D.slice(62)).toBe(
      "intro\n\n" + T3.slice(0, 55) + "\n|  |  |  |\n\noutro\n",
    );
    const swallows = spy.mock.calls.filter(([p]) => p.event === "ui.table.tab_swallowed");
    expect(swallows).toHaveLength(0);
  });

  it("C2-APPEND-UNDO: one undo restores each original; a second undo has nothing left", () => {
    for (const [, input, want] of TAILS) {
      const view = mountEditor(input);
      placeCursor(view, 26);
      expect(press(view, false).doc).toBe(want);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(input);
      expect(undo(view)).toBe(false);
      teardownEditor();
      seedStores();
    }
  });

  it("C2-APPEND-ONE-TX: the append is a single doc-changing transaction", () => {
    const view = mountEditor(P2);
    placeCursor(view, 26);
    const spy = vi.spyOn(view, "dispatch");
    const out = press(view, false);
    const changing = spy.mock.calls.filter(([arg]) => {
      const tr = arg as Transaction | TransactionSpec;
      return "docChanged" in tr ? tr.docChanged : tr.changes !== undefined;
    });
    expect(out.doc).toBe(P2 + ROW2 + "\n");
    expect(changing).toHaveLength(1);
  });

  it("C2-APPEND-CRLF: the editor holds LF only, and the append follows APPEND-3's shape", () => {
    const crlf = "| a |\r\n| - |\r\n| 1 |\r\n";
    seedStores();
    render(<Editor value={crlf} onChange={vi.fn()} />);
    const view = useEditorStore.getState().editorView!;
    expect(view).not.toBeNull();
    expect(view.state.doc.toString()).not.toContain("\r");
    placeCursor(view, 14);
    const out = press(view, false);
    expect(out.doc).not.toContain("\r");
    expect(out.doc).toBe("| a |\n| - |\n| 1 |\n|  |\n");
  });
});

/** The C1-RT domain (first 200, enumeration order): header {h,x}^cc, 1-2 body rows {"",x,yy}^cc. */
function rtTables(limit: number): string[][][] {
  const tuples = (alpha: readonly string[], n: number): string[][] => {
    let out: string[][] = [[]];
    for (let i = 0; i < n; i += 1) out = out.flatMap((t) => alpha.map((a) => [...t, a]));
    return out;
  };
  const out: string[][][] = [];
  for (const cc of [1, 2, 3]) {
    for (const h of tuples(["h", "x"], cc)) {
      for (const b1 of tuples(["", "x", "yy"], cc)) {
        out.push([h, b1]);
        for (const b2 of tuples(["", "x", "yy"], cc)) out.push([h, b1, b2]);
      }
    }
  }
  return out.slice(0, limit);
}

describe("D41 WI-3 — conservation law", () => {
  it("C2-APPEND-CONS: appending changes nothing but the one inserted row (200 tables × 4 tails)", () => {
    const PREFIX = "x\n\n";
    const SUFFIXES = ["\n\nafter\n", "\nafter\n", "\n", ""];
    const tables = rtTables(200);
    expect(tables).toHaveLength(200);
    const view = mountEditor(T3);
    const violations: unknown[] = [];
    for (const rows of tables) {
      const cc = rows[0].length;
      const serialized = serializeRows(rows, new Array(cc).fill(null));
      expect(serialized.endsWith("\n")).toBe(false);
      const end = PREFIX.length + serialized.length;
      const lastLine = serialized.slice(serialized.lastIndexOf("\n") + 1);
      const caret = PREFIX.length + serialized.lastIndexOf("\n") + 1 + lastLine.lastIndexOf("|", lastLine.length - 2) + 2;
      for (const suffix of SUFFIXES) {
        const doc = PREFIX + serialized + suffix;
        resetDoc(view, doc, caret);
        const out = press(view, false);
        const want = doc.slice(0, end) + "\n|" + "  |".repeat(cc) + doc.slice(end);
        if (out.doc !== want || out.head !== end + 3 || out.ranges.length !== 1) {
          violations.push({ rows, suffix, head: out.head, want: end + 3 });
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
  });
});
