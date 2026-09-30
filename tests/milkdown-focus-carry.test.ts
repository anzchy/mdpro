/**
 * D37 WI-3 — FC-1..FC-13b: the focus-carry record (`src/utils/milkdownFocusCarry.ts`)
 * as a single-slot, consume-once state machine.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-233000.md`, §"Unit:
 * `src/utils/milkdownFocusCarry.ts` record", amended by the resolution sections (FC-10
 * gains `carryForward`; FC-12, FC-13, FC-13b; Gap 5 conservation; TTL floor 10 000).
 *
 * Real PM nodes (test schema), real `editorStore` / `documentStore`, fake timers. The one
 * mock is `loggingService`, the JSONL process boundary, used as a recording double.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logEventSync } = vi.hoisted(() => ({ logEventSync: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync,
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import type { Node } from "@milkdown/kit/prose/model";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import {
  FOCUS_CARRY_TTL_MS as TTL,
  armFocusCarry,
  carryForward,
  consumeFocusCarry,
  resetFocusCarry,
  type FocusSnapshot,
} from "../src/utils/milkdownFocusCarry";
import { docOf, schemaA } from "./helpers/caretAnchorSchemas";
import { createLcg } from "./helpers/headingCorpus";
import { FocusCarryModel, drawOp } from "./helpers/focusCarryModel";

const RESTORE_EVENT = "editor.milkdown.focus.restore";
const TTL_FLOOR_MS = 10_000;
const SLOW_REMOUNT_MS = 1500;
const FC10_SEED = 0xd37fc;
const FC10_SEQUENCES = 400;
const FC10_MAX_OPS = 12;
const MAX_LOG_STRING = 64;
const ALLOWED_LOG_KEYS = new Set(["documentId", "reason", "outcome", "generation"]);

function snap(documentId: string = "doc-a", text = "Hello", head = 3): FocusSnapshot {
  return { documentId, head, oldDoc: docOf(schemaA, [text]) };
}

interface LogLine {
  event: string;
  context?: Record<string, unknown>;
}
const lines = (): LogLine[] =>
  logEventSync.mock.calls.map((c) => c[0] as LogLine).filter((e) => e.event === RESTORE_EVENT);
const outcomes = () => lines().map((e) => e.context?.outcome);

beforeEach(() => {
  vi.useFakeTimers();
  resetFocusCarry();
  useDocumentStore.setState({ activeDocumentId: "doc-a" });
  useEditorStore.setState({ viewMode: "wysiwyg", editorView: null });
  logEventSync.mockClear();
});

afterEach(() => {
  resetFocusCarry();
  vi.useRealTimers();
});

describe("focus-carry record", () => {
  it("FC-1 consume-once; a consume hit logs nothing and clears the timer", () => {
    const s = snap();
    armFocusCarry(s, "mcp-insert", 1);
    const r = consumeFocusCarry("doc-a", 1);
    expect(r).not.toBeNull();
    expect(r!.documentId).toBe("doc-a");
    expect(r!.generation).toBe(1);
    expect(r!.reason).toBe("mcp-insert");
    expect(r!.oldDoc).toBe(s.oldDoc);
    expect(r!.head).toBe(s.head);
    expect(consumeFocusCarry("doc-a", 1)).toBeNull();
    vi.advanceTimersByTime(TTL + 1);
    expect(outcomes()).toEqual([]);
  });

  it("FC-2 a stale lower generation is dropped", () => {
    armFocusCarry(snap(), "mcp-write", 1);
    expect(consumeFocusCarry("doc-a", 2)).toBeNull();
    expect(consumeFocusCarry("doc-a", 1)).toBeNull();
    expect(lines().map((e) => e.context)).toEqual([
      { documentId: "doc-a", reason: "mcp-write", outcome: "skipped:stale", generation: 1 },
    ]);
  });

  it("FC-3 a newer generation survives an older consumer", () => {
    armFocusCarry(snap(), "mcp-write", 2);
    expect(consumeFocusCarry("doc-a", 1)).toBeNull();
    expect(outcomes()).toEqual([]);
    expect(consumeFocusCarry("doc-a", 2)?.generation).toBe(2);
  });

  it("FC-4 a doc switch drops the record", () => {
    armFocusCarry(snap(), "mcp-write", 1);
    expect(consumeFocusCarry("doc-b", 0)).toBeNull();
    expect(consumeFocusCarry("doc-a", 1)).toBeNull();
    expect(outcomes()).toEqual(["skipped:doc-changed"]);
    expect(lines()[0].context?.documentId).toBe("doc-a");
  });

  it("FC-5 re-arm supersedes", () => {
    const x = snap("doc-a", "X");
    const y = snap("doc-a", "Y");
    armFocusCarry(x, "mcp-insert", 1);
    armFocusCarry(y, "mcp-insert", 2);
    expect(consumeFocusCarry("doc-a", 1)).toBeNull();
    expect(consumeFocusCarry("doc-a", 2)?.oldDoc).toBe(y.oldDoc);
    vi.advanceTimersByTime(TTL + 1);
    expect(outcomes()).toEqual(["skipped:superseded"]);
    expect(lines()[0].context?.generation).toBe(1);
  });

  it("FC-6 viewMode leaving wysiwyg drops the record immediately", () => {
    armFocusCarry(snap(), "mcp-insert", 1);
    useEditorStore.setState({ viewMode: "source" });
    expect(outcomes()).toEqual(["skipped:mode-changed"]);
    useEditorStore.setState({ viewMode: "wysiwyg" });
    expect(consumeFocusCarry("doc-a", 1)).toBeNull();
    expect(outcomes()).toEqual(["skipped:mode-changed"]);
  });

  it("FC-7 an unrelated editorStore update keeps the record", () => {
    armFocusCarry(snap(), "mcp-insert", 1);
    useEditorStore.setState({ editorView: null });
    useEditorStore.setState({ viewMode: "wysiwyg" });
    expect(consumeFocusCarry("doc-a", 1)?.generation).toBe(1);
    expect(outcomes()).toEqual([]);
  });

  it("FC-8 a slow consume at 1500 ms still returns the record", () => {
    armFocusCarry(snap(), "mcp-insert", 1);
    vi.advanceTimersByTime(SLOW_REMOUNT_MS);
    expect(consumeFocusCarry("doc-a", 1)?.generation).toBe(1);
    expect(outcomes()).toEqual([]);
  });

  it("FC-9 TTL floor and boundary: consumable at TTL-1, expired exactly at TTL", () => {
    expect(TTL).toBeGreaterThanOrEqual(TTL_FLOOR_MS);
    armFocusCarry(snap(), "mcp-insert", 1);
    vi.advanceTimersByTime(TTL - 1);
    expect(consumeFocusCarry("doc-a", 1)?.generation).toBe(1);
    armFocusCarry(snap(), "mcp-insert", 1);
    vi.advanceTimersByTime(TTL - 1);
    expect(outcomes()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(outcomes()).toEqual(["skipped:expired"]);
    expect(consumeFocusCarry("doc-a", 1)).toBeNull();
    vi.advanceTimersByTime(TTL * 2);
    expect(outcomes()).toEqual(["skipped:expired"]);
  });

  it("FC-11 resetFocusCarry clears the slot and the timer, logging nothing", () => {
    armFocusCarry(snap(), "mcp-insert", 1);
    resetFocusCarry();
    vi.advanceTimersByTime(TTL + 1);
    expect(consumeFocusCarry("doc-a", 1)).toBeNull();
    expect(lines()).toEqual([]);
  });

  it("FC-12 re-arm clears and restarts the timer", () => {
    armFocusCarry(snap(), "mcp-insert", 1);
    vi.advanceTimersByTime(TTL - 2);
    armFocusCarry(snap(), "mcp-insert", 2);
    vi.advanceTimersByTime(2);
    expect(consumeFocusCarry("doc-a", 2)?.generation).toBe(2);
    vi.advanceTimersByTime(TTL);
    expect(outcomes()).toEqual(["skipped:superseded"]);
  });

  it("FC-13 carryForward re-arms a live record at the new generation, keeping oldDoc and head", () => {
    const s = snap("doc-a", "Hello", 4);
    armFocusCarry(s, "mcp-insert", 1);
    vi.advanceTimersByTime(TTL - 2);
    carryForward("doc-a", 2);
    vi.advanceTimersByTime(2);
    expect(consumeFocusCarry("doc-a", 1)).toBeNull();
    const r = consumeFocusCarry("doc-a", 2);
    expect(r?.oldDoc).toBe(s.oldDoc);
    expect(r?.head).toBe(4);
    expect(r?.generation).toBe(2);
    expect(outcomes()).toEqual(["skipped:superseded"]);
    expect(lines()[0].context?.generation).toBe(1);
  });

  it("FC-13 carryForward with no live record is a no-op that logs nothing", () => {
    carryForward("doc-a", 2);
    expect(consumeFocusCarry("doc-a", 2)).toBeNull();
    expect(lines()).toEqual([]);
  });

  it("FC-13b carryForward for another document leaves the record untouched", () => {
    const s = snap("doc-b");
    armFocusCarry(s, "mcp-insert", 1);
    carryForward("doc-a", 2);
    expect(outcomes()).toEqual([]);
    expect(consumeFocusCarry("doc-b", 1)?.oldDoc).toBe(s.oldDoc);
    expect(consumeFocusCarry("doc-a", 2)).toBeNull();
  });

  it("FC-13b carryForward is a no-op when the document is not active or the mode is source", () => {
    armFocusCarry(snap(), "mcp-insert", 1);
    useDocumentStore.setState({ activeDocumentId: "doc-b" });
    carryForward("doc-a", 2);
    useDocumentStore.setState({ activeDocumentId: "doc-a" });
    expect(consumeFocusCarry("doc-a", 1)?.generation).toBe(1);

    useEditorStore.setState({ viewMode: "source" });
    armFocusCarry(snap(), "mcp-insert", 1);
    carryForward("doc-a", 2);
    useEditorStore.setState({ viewMode: "wysiwyg" });
    expect(consumeFocusCarry("doc-a", 1)?.generation).toBe(1);
    expect(outcomes()).toEqual([]);
  });

  it("FC-10 conservation and single slot hold over generated op sequences", () => {
    const next = createLcg(FC10_SEED);
    for (let seq = 0; seq < FC10_SEQUENCES; seq++) {
      resetFocusCarry();
      useDocumentStore.setState({ activeDocumentId: "doc-a" });
      useEditorStore.setState({ viewMode: "wysiwyg" });
      logEventSync.mockClear();
      const model = new FocusCarryModel(TTL);
      let hits = 0;
      const count = 1 + (next() % FC10_MAX_OPS);
      const trace: string[] = [];
      for (let i = 0; i < count; i++) {
        const op = drawOp(next, TTL);
        trace.push(JSON.stringify(op));
        const where = `seed ${FC10_SEED} seq ${seq}: ${trace.join(" ")}`;
        if (op.k === "arm") {
          const s = snap(op.doc);
          model.arm(op.doc, op.gen, s.oldDoc);
          armFocusCarry(s, "mcp-insert", op.gen);
        } else if (op.k === "consume") {
          const expected = model.consume(op.doc, op.gen);
          const got = consumeFocusCarry(op.doc, op.gen);
          if (got) hits += 1;
          expect(got?.oldDoc ?? null, where).toBe(expected?.oldDoc ?? null);
          if (got) expect([got.documentId, got.generation], where).toEqual([op.doc, op.gen]);
        } else if (op.k === "carry") {
          model.carry(op.doc, op.gen);
          carryForward(op.doc, op.gen);
        } else if (op.k === "advance") {
          model.advance(op.ms);
          vi.advanceTimersByTime(op.ms);
        } else if (op.k === "mode") {
          model.setMode(op.mode);
          useEditorStore.setState({ viewMode: op.mode });
        } else if (op.k === "touch") {
          useEditorStore.setState({ editorView: null });
        } else {
          model.active = op.doc;
          useDocumentStore.setState({ activeDocumentId: op.doc });
        }
        const logged = lines();
        expect(logged.length + hits, `terminal count, ${where}`).toBe(model.terminals);
        expect(model.arms, `L4, ${where}`).toBe(logged.length + hits + (model.live ? 1 : 0));
        for (const e of logged) expectContentFree(e.context ?? {}, where);
      }
    }
  });
});

function expectContentFree(context: Record<string, unknown>, where: string): void {
  for (const [key, value] of Object.entries(context)) {
    expect(ALLOWED_LOG_KEYS.has(key), `log key ${key}, ${where}`).toBe(true);
    expect(isNode(value), `log value is a PM Node, ${where}`).toBe(false);
    if (typeof value === "string") expect(value.length, where).toBeLessThanOrEqual(MAX_LOG_STRING);
  }
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "nodeSize" in value;
}
