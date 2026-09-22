/**
 * The per-document Source table verdict record (WI-3, re-expressed per
 * orchestrator amendment A1 of plan-20260922-113723).
 *
 * App's guard effect reruns on every content edit. In Source, ADR-0022 allows
 * one row-count pass per document on the open path, not one per keystroke, so
 * the first verdict for a document id is recorded and never overwritten in the
 * session. A repeat record must be a true no-op: `false`, the same state
 * reference, and zero subscriber notifications — otherwise every keystroke
 * re-renders every subscriber.
 *
 * Law (E7): the first verdict per id wins; the number of `true` returns equals
 * the number of distinct ids.
 *
 * Deviation from the matrix (E8): `pendingTableCell` is not editorStore state;
 * it is the module slot in `src/utils/cursorSync/table.ts`. E8 pins it through
 * `getPendingTableCell()` identity instead.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import type { EditorView } from "@codemirror/view";
import {
  useEditorStore,
  isSourceTablesWithheld,
  hasSourceTableVerdict,
  type SourceTableVerdict,
} from "../src/stores/editorStore";
import {
  getPendingTableCell,
  setPendingTableCell,
  type PendingTableCapture,
} from "../src/utils/cursorSync/table";

const store = () => useEditorStore.getState();
const record = (id: string, verdict: SourceTableVerdict) =>
  store().recordSourceTableVerdict(id, verdict);

/** mulberry32 — a tiny deterministic PRNG so the seeded cases replay exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(() => {
  useEditorStore.setState({
    sourceTableVerdicts: {},
    viewMode: "source",
    editorView: null,
  });
  setPendingTableCell(null);
});

describe("editorStore — Source table verdict record", () => {
  it("E1: a first 'withheld' record returns true and is visible", () => {
    expect(record("doc-A", "withheld")).toBe(true);
    expect(isSourceTablesWithheld(store(), "doc-A")).toBe(true);
    expect(hasSourceTableVerdict(store(), "doc-A")).toBe(true);
    expect(store().sourceTableVerdicts).toEqual({ "doc-A": "withheld" });
  });

  it("E1b: a first 'allowed' record returns true, but the id is not withheld", () => {
    expect(record("doc-A", "allowed")).toBe(true);
    expect(hasSourceTableVerdict(store(), "doc-A")).toBe(true);
    expect(isSourceTablesWithheld(store(), "doc-A")).toBe(false);
    expect(store().sourceTableVerdicts).toEqual({ "doc-A": "allowed" });
  });

  it("E2: a repeat record is a no-op — false, same references, zero notifications", () => {
    record("doc-A", "withheld");
    const before = store();
    const map = before.sourceTableVerdicts;
    let calls = 0;
    const unsubscribe = useEditorStore.subscribe(() => {
      calls++;
    });

    const second = record("doc-A", "withheld");
    unsubscribe();

    expect(second).toBe(false);
    expect(store()).toBe(before);
    expect(store().sourceTableVerdicts).toBe(map);
    expect(calls).toBe(0);
  });

  it("E3: ids are isolated", () => {
    record("doc-A", "withheld");
    expect(isSourceTablesWithheld(store(), "doc-B")).toBe(false);
    expect(hasSourceTableVerdict(store(), "doc-B")).toBe(false);

    expect(record("doc-B", "allowed")).toBe(true);
    expect(store().sourceTableVerdicts).toEqual({
      "doc-A": "withheld",
      "doc-B": "allowed",
    });
  });

  it("E4: selectors read null, unknown and prototype-named ids as absent", () => {
    const ids: (string | null)[] = [
      null,
      "missing",
      "",
      "constructor",
      "toString",
      "__proto__",
    ];
    const results = ids.flatMap((id) => [
      isSourceTablesWithheld(store(), id),
      hasSourceTableVerdict(store(), id),
    ]);
    expect(results).toEqual(new Array(ids.length * 2).fill(false));

    expect(record("constructor", "withheld")).toBe(true);
    expect(isSourceTablesWithheld(store(), "constructor")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(store().sourceTableVerdicts, "constructor")).toBe(true);
  });

  it("E5: view-mode transitions do not clear verdicts", () => {
    record("doc-A", "withheld");
    const expected = { "doc-A": "withheld" };

    store().setViewMode("wysiwyg");
    expect(store().viewMode).toBe("wysiwyg");
    expect(store().sourceTableVerdicts).toEqual(expected);

    store().setViewMode("source");
    expect(store().viewMode).toBe("source");
    expect(store().sourceTableVerdicts).toEqual(expected);

    store().cycleViewMode();
    expect(store().viewMode).toBe("wysiwyg");
    expect(store().sourceTableVerdicts).toEqual(expected);

    store().cycleViewMode();
    expect(store().viewMode).toBe("source");
    expect(store().sourceTableVerdicts).toEqual(expected);
  });

  it("E6: a recorded verdict is sticky in both directions", () => {
    record("doc-A", "allowed");
    const mapA = store().sourceTableVerdicts;
    expect(record("doc-A", "withheld")).toBe(false);
    expect(store().sourceTableVerdicts).toBe(mapA);

    record("doc-B", "withheld");
    const mapB = store().sourceTableVerdicts;
    expect(record("doc-B", "allowed")).toBe(false);
    expect(store().sourceTableVerdicts).toBe(mapB);

    expect(isSourceTablesWithheld(store(), "doc-A")).toBe(false);
    expect(hasSourceTableVerdict(store(), "doc-A")).toBe(true);
    expect(isSourceTablesWithheld(store(), "doc-B")).toBe(true);
    expect(store().sourceTableVerdicts).toEqual({
      "doc-A": "allowed",
      "doc-B": "withheld",
    });
  });

  it("E7: first verdict wins over a seeded operation sequence", () => {
    const ids = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "constructor"];
    const verdicts: SourceTableVerdict[] = ["allowed", "withheld"];

    for (const seed of [2, 17, 20260922]) {
      useEditorStore.setState({ sourceTableVerdicts: {} });
      const rand = mulberry32(seed);
      const oracle = new Map<string, SourceTableVerdict>();
      let trues = 0;
      let calls = 0;
      const unsubscribe = useEditorStore.subscribe(() => {
        calls++;
      });

      for (let op = 0; op < 300; op++) {
        const id = ids[Math.floor(rand() * ids.length)];
        const verdict = verdicts[Math.floor(rand() * verdicts.length)];
        const seenBefore = oracle.has(id);
        if (!seenBefore) oracle.set(id, verdict);
        const result = record(id, verdict);
        expect(result).toBe(!seenBefore);
        if (result) trues++;
      }
      unsubscribe();

      expect(store().sourceTableVerdicts).toEqual(Object.fromEntries(oracle));
      expect(trues).toBe(oracle.size);
      expect(calls).toBe(oracle.size);
    }
  });

  it("E8: recording leaves unrelated state untouched", () => {
    const sentinelView = { sentinel: true } as unknown as EditorView;
    const pending: PendingTableCapture = {
      documentId: "doc-A",
      pos: { tableIndex: 0, rowIndex: 1, colIndex: 2 },
    };
    useEditorStore.setState({ viewMode: "source", editorView: sentinelView });
    setPendingTableCell(pending);
    const pendingBefore = getPendingTableCell();

    record("doc-A", "withheld");

    expect(store().viewMode).toBe("source");
    expect(store().editorView).toBe(sentinelView);
    expect(getPendingTableCell()).toBe(pendingBefore);
    expect(pendingBefore).not.toBeNull();
  });
});
