/**
 * D58 amendment A2: `useMilkdownEditorStore#flushPendingEditsFor(id, reason)` flushes only
 * the target document's live (newest) flusher, never throws, and decomposes the global
 * `flushPendingEdits` (F9).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-131500.md`, "Unit: stores/milkdownEditorStore
 * #flushPendingEditsFor", cases F1–F9. Only `@tauri-apps/api/core` `invoke` is mocked;
 * `loggingService`, every store and the edit-sync controller are real. The action is read
 * through `getState()` behind a `typeof` assertion, so today's red is an assertion failure
 * rather than a missing-module error. Fake timers, never advanced (§0.4). jsdom: the
 * node marker (§0.8) trips on `documentStore`'s import chain (DOMPurify via exportService).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import {
  useMilkdownEditorStore,
  type FlushResult,
  type Flusher,
  type FlusherStatus,
} from "../src/stores/milkdownEditorStore";
import {
  DOCB,
  F,
  P,
  TYPED,
  allLogs,
  assertPreconditions,
  bindInvoke,
  closedWorldViolations,
  content,
  customFlusher,
  flushContexts,
  logs,
  pending,
  register,
  resetTableFixture,
  snapshot,
} from "./helpers/mcpTableD58Fixture";

const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
);

type FlushFor = (documentId: string, reason: string) => FlushResult;

/** The action under test, asserted present so a missing export fails on an assertion. */
function flushFor(documentId: string, reason: string): FlushResult {
  const fn = (useMilkdownEditorStore.getState() as unknown as { flushPendingEditsFor?: FlushFor })
    .flushPendingEditsFor;
  expect(typeof fn, "flushPendingEditsFor must be a store action").toBe("function");
  return (fn as FlushFor)(documentId, reason);
}

beforeAll(() => {
  bindInvoke(invoke);
  assertPreconditions();
});

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockClear();
  useLoggingStore.setState({ enabled: true, level: "info" });
  resetTableFixture({ docA: F, docB: DOCB });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("flushPendingEditsFor (D58 A2)", () => {
  it("F1: only the target's flusher runs", () => {
    pending("doc-a", () => P);
    pending("doc-b", () => DOCB + TYPED);
    const snapB = snapshot("doc-b");

    expect(flushFor("doc-a", "d58-store")).toEqual({ status: "written" });
    expect(content("doc-a")).toBe(P);
    expect(snapshot("doc-b")).toEqual(snapB);
    expect(flushContexts()).toEqual([
      { reason: "d58-store", documentId: "doc-a", outcome: "written" },
    ]);
  });

  it("F2: another document's throwing flusher is never invoked", () => {
    let calls = 0;
    register("doc-a", () => F);
    customFlusher("doc-b", () => {
      calls++;
      throw new Error("D58 doc-b serializer");
    });
    const snapB = snapshot("doc-b");

    expect(flushFor("doc-a", "d58-store")).toEqual({ status: "clean" });
    expect(logs("editor.milkdown.flush").filter((p) => p.status === "fail")).toEqual([]);
    expect(snapshot("doc-b")).toEqual(snapB);
    expect(calls).toBe(0);
  });

  it("F3: with several registrations for one document, only the newest runs", () => {
    // (a) older throwing raw flusher, newer pending controller
    let oldCalls = 0;
    customFlusher("doc-a", () => {
      oldCalls++;
      throw new Error("D58 stale registration");
    });
    pending("doc-a", () => P);
    expect(flushFor("doc-a", "d58-store")).toEqual({ status: "written" });
    expect(oldCalls).toBe(0);
    expect(logs("editor.milkdown.flush").filter((p) => p.status === "fail")).toEqual([]);

    // (b) older pending "STALE", newer clean controller
    resetTableFixture({ docA: F, docB: DOCB });
    pending("doc-a", () => "STALE");
    register("doc-a", () => F);
    expect(flushFor("doc-a", "d58-store")).toEqual({ status: "clean" });
    expect(content("doc-a")).toBe(F);
  });

  it("F4: an unknown id returns clean and changes nothing", () => {
    pending("doc-a", () => P);
    const snapA = snapshot("doc-a");
    const flushers = useMilkdownEditorStore.getState().flushers;
    invoke.mockClear();

    expect(flushFor("doc-missing", "r")).toEqual({ status: "clean" });
    expect(snapshot("doc-a")).toEqual(snapA);
    expect(allLogs()).toEqual([]);
    expect(useMilkdownEditorStore.getState().flushers).toBe(flushers);
  });

  it("F5: never throws, for an Error or a non-Error", () => {
    customFlusher("doc-a", () => {
      throw new Error("boom-e");
    });
    let result: FlushResult | undefined;
    expect(() => {
      result = flushFor("doc-a", "r");
    }).not.toThrow();
    expect(result).toEqual({ status: "failed" });

    resetTableFixture({ docA: F, docB: DOCB });
    customFlusher("doc-a", () => {
      throw "boom-s";
    });
    expect(() => {
      result = flushFor("doc-a", "r");
    }).not.toThrow();
    expect(result).toEqual({ status: "failed" });
  });

  it("F6: a discarded (terminal) controller counts as clean", () => {
    // `discard()` makes the controller terminal without a write; `destroy()` would write.
    const c = pending("doc-a", () => P);
    c.discard();
    expect(c.flush("probe")).toEqual({ status: "destroyed" });

    expect(flushFor("doc-a", "r")).toEqual({ status: "clean" });
    expect(content("doc-a")).toBe(F);
  });

  it("F7: log shape for a throwing flusher", () => {
    const failEntry = (error: string) => ({
      level: "warn",
      event: "editor.milkdown.flush",
      status: "fail",
      actionId: expect.any(String),
      context: { reason: "r", documentId: "doc-a", outcome: "failed" },
      error,
    });

    customFlusher("doc-a", () => {
      throw new Error("boom-e");
    });
    flushFor("doc-a", "r");
    expect(logs("editor.milkdown.flush")).toEqual([failEntry("boom-e")]);

    resetTableFixture({ docA: F, docB: DOCB });
    invoke.mockClear();
    customFlusher("doc-a", () => {
      throw "boom-s";
    });
    flushFor("doc-a", "r");
    expect(logs("editor.milkdown.flush")).toEqual([failEntry("boom-s")]);
  });

  it("F8: idempotence, written then clean", () => {
    pending("doc-a", () => P);
    expect(flushFor("doc-a", "r")).toEqual({ status: "written" });
    expect(content("doc-a")).toBe(P);
    expect(flushFor("doc-a", "r")).toEqual({ status: "clean" });
    expect(content("doc-a")).toBe(P);
    // Today's controller emission: one success log per explicit flush.
    expect(flushContexts()).toEqual([
      { reason: "r", documentId: "doc-a", outcome: "written" },
      { reason: "r", documentId: "doc-a", outcome: "clean" },
    ]);
  });

  it("F9: decomposition and isolation over the enumerated registry domain (961 configurations)", () => {
    type Kind = "clean" | "written" | "failed" | "throws" | "destroyed";
    const KINDS: Kind[] = ["clean", "written", "failed", "throws", "destroyed"];
    const STACKS: Kind[][] = [[], ...KINDS.map((s) => [s]), ...KINDS.flatMap((o) => KINDS.map((s) => [o, s]))];
    const RANK = { clean: 0, written: 1, failed: 2 } as const;
    const IDS = ["doc-a", "doc-b"] as const;

    interface Run {
      status: string;
      snaps: unknown;
      ctxs: string[];
      counters: Record<string, number[]>;
      threw: string | null;
      grammar: string[];
    }

    const makeFlusher = (id: string, kind: Kind, counters: number[], i: number): Flusher => () => {
      counters[i]++;
      switch (kind) {
        case "clean":
          return { status: "clean" };
        case "written":
          // A raw "written" flusher writes "W-<id>", as a controller would.
          useDocumentStore.getState().updateDocumentContent(id, `W-${id}`);
          return { status: "written" };
        case "failed":
          return { status: "failed" };
        case "throws":
          throw new Error(`D58 F9 throw ${id}`);
        case "destroyed":
          return { status: "destroyed" satisfies FlusherStatus };
      }
    };

    function run(stacks: Record<string, Kind[]>, drive: () => string): Run {
      resetTableFixture({ docA: F, docB: DOCB });
      invoke.mockClear();
      const counters: Record<string, number[]> = {};
      for (const id of IDS) {
        counters[id] = stacks[id].map(() => 0);
        stacks[id].forEach((kind, i) => customFlusher(id, makeFlusher(id, kind, counters[id], i)));
      }
      let status = "";
      let threw: string | null = null;
      try {
        status = drive();
      } catch (e) {
        threw = e instanceof Error ? e.message : String(e);
      }
      return {
        status,
        snaps: { a: snapshot("doc-a"), b: snapshot("doc-b") },
        ctxs: flushContexts().map((c) => JSON.stringify(c)).sort(),
        counters,
        threw,
        grammar: closedWorldViolations([]),
      };
    }

    const bad: Array<{ cfg: string; why: string }> = [];
    let configurations = 0;
    for (const sa of STACKS) {
      for (const sb of STACKS) {
        configurations++;
        const stacks: Record<string, Kind[]> = { "doc-a": sa, "doc-b": sb };
        const cfg = `a=[${sa.join(",")}] b=[${sb.join(",")}]`;
        const note = (why: string) => bad.push({ cfg, why });

        const X = run(stacks, () => useMilkdownEditorStore.getState().flushPendingEdits("f9").status);
        const Y = run(stacks, () => {
          const ya = flushFor("doc-a", "f9").status;
          const yb = flushFor("doc-b", "f9").status;
          return RANK[ya] >= RANK[yb] ? ya : yb;
        });
        resetTableFixture({ docA: F, docB: DOCB });
        const arrangedB = snapshot("doc-b");
        const Z = run(stacks, () => flushFor("doc-a", "f9").status);

        for (const [name, r] of [["X", X], ["Y", Y], ["Z", Z]] as const) {
          if (r.threw !== null) note(`${name} threw: ${r.threw}`);
          for (const id of IDS) {
            const c = r.counters[id];
            if (c.slice(0, -1).some((n) => n !== 0)) note(`${name}: a non-newest ${id} flusher ran`);
          }
          if (r.grammar.length) note(`${name}: ${r.grammar[0]}`);
        }
        if (X.status !== Y.status) note(`status X=${X.status} Y=${Y.status}`);
        if (JSON.stringify(X.snaps) !== JSON.stringify(Y.snaps)) note("snapshots X != Y");
        if (JSON.stringify(X.ctxs) !== JSON.stringify(Y.ctxs)) note("flush-log contexts X != Y");
        const zb = (Z.snaps as { b: unknown }).b;
        if (JSON.stringify(zb) !== JSON.stringify(arrangedB)) note("Z changed doc-b");
        if (Z.counters["doc-b"].some((n) => n !== 0)) note("Z invoked a doc-b flusher");
      }
    }

    expect(configurations).toBe(961);
    expect({ count: bad.length, first: bad[0] }).toEqual({ count: 0, first: undefined });
  });
});

