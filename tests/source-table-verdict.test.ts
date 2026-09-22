/**
 * The A1 helpers (plan-20260922-113723, orchestrator amendment A1) and their
 * composition: in Source the guard scans a document once per session, not once
 * per keystroke (ADR-0022 Consequences: one pass on the Source open path).
 *
 * - `shouldEvaluateGuard(viewMode, docId, state)` — false exactly when the mode
 *   is Source and the document already has a recorded verdict (V1, V2).
 * - `sourceTableVerdictOf(viewMode, decision)` — the verdict a decision records,
 *   or null when it records none (V3).
 * - G1-G6 compose the real guard, the real store and both helpers through a
 *   harness whose step order restates App's guard effect:
 *   shouldEvaluateGuard -> decideLargeDocumentGuard -> sourceTableVerdictOf ->
 *   recordSourceTableVerdict. STATED GAP: only the WI-6 source-text pin (C17)
 *   will pin that App uses the same order; this file cannot see App.tsx.
 *
 * Counts, not milliseconds (E39): "reads" is the number of times a counting
 * getter on the document's content was read.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import {
  useEditorStore,
  type SourceTableVerdict,
} from "../src/stores/editorStore";
import {
  shouldEvaluateGuard,
  sourceTableVerdictOf,
} from "../src/utils/sourceTableVerdict";
import {
  LARGE_DOCUMENT_DOWNGRADE_MESSAGE,
  SOURCE_TABLE_WITHHOLD_MESSAGE,
  decideLargeDocumentGuard,
  type LargeDocumentGuardDecision,
} from "../src/utils/largeDocumentGuard";
import type { ViewMode } from "../src/types/editor";

const ROWS_OVER = "|\n".repeat(50_001);
const SMALL_TABLE = "| a |\n".repeat(10);

const store = () => useEditorStore.getState();

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

interface CountingDoc {
  id: string;
  text: string;
  reads: number;
  readonly content: string;
}

function makeDoc(id: string, text: string): CountingDoc {
  return {
    id,
    text,
    reads: 0,
    get content() {
      this.reads++;
      return this.text;
    },
  };
}

interface Evaluation {
  evaluated: boolean;
  decision: LargeDocumentGuardDecision | null;
  signalled: boolean;
}

/** The App guard effect's order, restated (see the header's STATED GAP). */
function evaluate(viewMode: ViewMode, doc: CountingDoc): Evaluation {
  if (!shouldEvaluateGuard(viewMode, doc.id, store())) {
    return { evaluated: false, decision: null, signalled: false };
  }
  const decision = decideLargeDocumentGuard({ viewMode, content: doc.content });
  const verdict = sourceTableVerdictOf(viewMode, decision);
  let signalled = false;
  if (verdict !== null) {
    const first = store().recordSourceTableVerdict(doc.id, verdict);
    signalled = first && decision.action === "withhold-table-extensions";
  }
  return { evaluated: true, decision, signalled };
}

beforeEach(() => {
  useEditorStore.setState({ sourceTableVerdicts: {}, viewMode: "source" });
});

describe("shouldEvaluateGuard", () => {
  it("V1: exhaustive truth table over 2 modes x 3 verdict states", () => {
    const results: boolean[] = [];
    const states: (SourceTableVerdict | null)[] = [null, "allowed", "withheld"];
    for (const mode of ["wysiwyg", "source"] as const) {
      for (const verdict of states) {
        useEditorStore.setState({ sourceTableVerdicts: {} });
        if (verdict !== null) store().recordSourceTableVerdict("doc-A", verdict);
        results.push(shouldEvaluateGuard(mode, "doc-A", store()));
      }
    }
    expect(results).toEqual([true, true, true, true, false, false]);
  });

  it("V2: once false in Source, always false; always true in WYSIWYG", () => {
    const ids = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "constructor"];
    const verdicts: SourceTableVerdict[] = ["allowed", "withheld"];

    for (const seed of [2, 17, 20260922]) {
      useEditorStore.setState({ sourceTableVerdicts: {} });
      const rand = mulberry32(seed);
      const recorded = new Set<string>();
      const sourceTraces = new Map<string, boolean[]>(ids.map((id) => [id, []]));
      const expectedTraces = new Map<string, boolean[]>(ids.map((id) => [id, []]));
      const wysiwyg: boolean[] = [];

      for (let op = 0; op < 300; op++) {
        const id = ids[Math.floor(rand() * ids.length)];
        const verdict = verdicts[Math.floor(rand() * verdicts.length)];
        store().recordSourceTableVerdict(id, verdict);
        recorded.add(id);
        for (const each of ids) {
          sourceTraces.get(each)!.push(shouldEvaluateGuard("source", each, store()));
          expectedTraces.get(each)!.push(!recorded.has(each));
          wysiwyg.push(shouldEvaluateGuard("wysiwyg", each, store()));
        }
      }

      for (const id of ids) {
        const trace = sourceTraces.get(id)!;
        const firstFalse = trace.indexOf(false);
        if (firstFalse !== -1) {
          expect(trace.slice(firstFalse).every((v) => v === false)).toBe(true);
        }
        expect(trace).toEqual(expectedTraces.get(id));
      }
      expect(wysiwyg.every((v) => v === true)).toBe(true);
    }
  });
});

describe("sourceTableVerdictOf", () => {
  it("V3: exhaustive truth table over 2 modes x 3 decision arms", () => {
    const sourceAllow = decideLargeDocumentGuard({ viewMode: "source", content: "| a |\n" });
    const sourceWithhold = decideLargeDocumentGuard({ viewMode: "source", content: ROWS_OVER });
    const wysiwygAllow = decideLargeDocumentGuard({ viewMode: "wysiwyg", content: "| a |\n" });
    const wysiwygDegrade = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      content: "\n".repeat(25_001),
    });
    expect(sourceAllow.action).toBe("allow");
    expect(sourceWithhold.action).toBe("withhold-table-extensions");
    expect(wysiwygAllow.action).toBe("allow");
    expect(wysiwygDegrade.action).toBe("degrade-to-source");

    // Unreachable combinations, built by hand.
    const handDegrade: LargeDocumentGuardDecision = {
      action: "degrade-to-source",
      message: "m",
      elements: 25_001,
      longestLine: 0,
      trigger: "structure",
    };
    const handWithhold: LargeDocumentGuardDecision = {
      action: "withhold-table-extensions",
      message: "m",
      tableRows: 50_001,
    };

    expect([
      sourceTableVerdictOf("source", sourceAllow),
      sourceTableVerdictOf("source", sourceWithhold),
      sourceTableVerdictOf("source", handDegrade),
      sourceTableVerdictOf("wysiwyg", wysiwygAllow),
      sourceTableVerdictOf("wysiwyg", wysiwygDegrade),
      sourceTableVerdictOf("wysiwyg", handWithhold),
    ]).toEqual(["allowed", "withheld", null, null, null, null]);
  });
});

describe("A1 composition — once per document in Source", () => {
  it("G1: 20 edits of a withheld document read content once and signal once", () => {
    const docA = makeDoc("docA", ROWS_OVER);
    const runs = Array.from({ length: 20 }, () => evaluate("source", docA));

    expect(docA.reads).toBe(1);
    expect(runs.filter((r) => r.evaluated).length).toBe(1);
    expect(runs.filter((r) => r.signalled).length).toBe(1);
    expect(store().sourceTableVerdicts).toEqual({ docA: "withheld" });
    expect(runs[0].decision).toEqual({
      action: "withhold-table-extensions",
      message: SOURCE_TABLE_WITHHOLD_MESSAGE,
      tableRows: 50_001,
    });
  });

  it("G2: 20 edits of an allowed document read content once", () => {
    const docS = makeDoc("docS", SMALL_TABLE);
    const runs = Array.from({ length: 20 }, () => evaluate("source", docS));

    expect(docS.reads).toBe(1);
    expect(runs.filter((r) => r.signalled).length).toBe(0);
    expect(store().sourceTableVerdicts).toEqual({ docS: "allowed" });
  });

  it("G3: WYSIWYG is unchanged — every edit evaluates and nothing is recorded", () => {
    const docW = makeDoc("docW", "\n".repeat(25_001));
    const runs = Array.from({ length: 20 }, () => evaluate("wysiwyg", docW));

    expect(docW.reads).toBe(20);
    for (const run of runs) {
      expect(run.decision).toEqual({
        action: "degrade-to-source",
        message: LARGE_DOCUMENT_DOWNGRADE_MESSAGE,
        elements: 25_001,
        longestLine: 0,
        trigger: "structure",
      });
    }
    expect(store().sourceTableVerdicts).toEqual({});
  });

  it("G4: switching documents re-evaluates each document exactly once", () => {
    const A = makeDoc("A", ROWS_OVER);
    const B = makeDoc("B", SMALL_TABLE);
    const runs = [A, B, A, B, A].map((doc) => evaluate("source", doc));

    expect(A.reads).toBe(1);
    expect(B.reads).toBe(1);
    expect(runs.map((r) => r.signalled)).toEqual([true, false, false, false, false]);
    expect(store().sourceTableVerdicts).toEqual({ A: "withheld", B: "allowed" });
  });

  it("G5: accepted limits — growth under the same id, and the degrade path", () => {
    // (a) The recorded A1 limit: an open-time verdict survives growth.
    const docG = makeDoc("docG", "|\n".repeat(50_000));
    const first = evaluate("source", docG);
    docG.text = ROWS_OVER;
    const later = Array.from({ length: 5 }, () => evaluate("source", docG));

    expect(docG.reads).toBe(1);
    expect(store().sourceTableVerdicts.docG).toBe("allowed");
    expect([first, ...later].filter((r) => r.signalled).length).toBe(0);

    // (b) A WYSIWYG degrade records nothing; the first Source visit still scans.
    const docD = makeDoc("docD", ROWS_OVER);
    const wysiwygRun = evaluate("wysiwyg", docD);
    expect(docD.reads).toBe(1);
    expect(wysiwygRun.decision?.action).toBe("degrade-to-source");

    const sourceRuns = Array.from({ length: 5 }, () => evaluate("source", docD));
    expect(docD.reads).toBe(2);
    expect(store().sourceTableVerdicts.docD).toBe("withheld");
    expect(sourceRuns.filter((r) => r.signalled).length).toBe(1);
  });

  it("G6: at most one Source evaluation per id over a seeded session", () => {
    const texts: Record<string, string> = { A: ROWS_OVER, B: SMALL_TABLE, C: "x" };
    const ids = Object.keys(texts);
    const modes: ViewMode[] = ["source", "wysiwyg"];

    for (const seed of [4, 64, 20260922]) {
      useEditorStore.setState({ sourceTableVerdicts: {} });
      const rand = mulberry32(seed);
      const docs = new Map(ids.map((id) => [id, makeDoc(id, texts[id])]));
      const actual = new Map(ids.map((id) => [id, { source: 0, wysiwyg: 0 }]));
      const visitedInSource = new Set<string>();
      const wysiwygOps = new Map(ids.map((id) => [id, 0]));
      let signals = 0;

      for (let op = 0; op < 200; op++) {
        const id = ids[Math.floor(rand() * ids.length)];
        const mode = modes[Math.floor(rand() * modes.length)];
        const doc = docs.get(id)!;
        const readsBefore = doc.reads;
        if (evaluate(mode, doc).signalled) signals++;
        actual.get(id)![mode] += doc.reads - readsBefore;
        if (mode === "source") visitedInSource.add(id);
        else wysiwygOps.set(id, wysiwygOps.get(id)! + 1);
      }

      const actualTuples = ids.map((id) => [id, actual.get(id)!.source, actual.get(id)!.wysiwyg]);
      const oracleTuples = ids.map((id) => [
        id,
        visitedInSource.has(id) ? 1 : 0,
        wysiwygOps.get(id)!,
      ]);
      expect(actualTuples).toEqual(oracleTuples);
      expect(signals).toBe(visitedInSource.has("A") ? 1 : 0);
    }
  });
});
