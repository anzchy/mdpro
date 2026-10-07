// @vitest-environment node
/**
 * D15 WI-1 — `createEditSyncController` (src/plugins/milkdown/editSync/controller.ts).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260922-163219.md` § "Unit: … controller.ts"
 * cases C1–C18. Laws L-C1 (convergence), L-C2 (idempotence), L-C3 (monotonic
 * revision), L-C4 (no loss of dirtiness), L-C5 (terminal destroy).
 *
 * Mock boundary: only `loggingService` (process boundary). `useDocumentStore` is real
 * and reset in `beforeEach`; timers are faked. `getMarkdown` is a test-owned closure
 * over a mutable `current` string — the injected serializer input, not a mock of the
 * logic under test.
 *
 * Write counting (§0.5): a subscription counts emissions in which the owner
 * document's object reference changed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../src/types/document";

const logEventSyncMock = vi.fn();
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: (...args: unknown[]) => logEventSyncMock(...args),
    logEvent: async () => undefined,
    generateActionId: () => "test-action-id",
  },
}));

import {
  createEditSyncController,
  EDIT_SYNC_DELAY_MS,
  type EditSyncController,
} from "../src/plugins/milkdown/editSync/controller";
import { useDocumentStore } from "../src/stores/documentStore";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";

const DELAY = EDIT_SYNC_DELAY_MS;
const FLUSH_EVENT = "editor.milkdown.flush";

function makeDoc(id: string, content: string, isModified = false): Document {
  return {
    id,
    path: `/tmp/${id}.md`,
    content,
    encoding: "utf-8",
    lineEnding: "lf",
    isModified,
    lastSaved: null,
    fileSize: null,
  };
}

let seedA: Document;
let seedB: Document;
let current: string;
let throwNext: boolean;
let serializeCount: number;
const unsubs: Array<() => void> = [];

function resetStore(aModified = false): void {
  seedA = makeDoc("doc-a", "Hello", aModified);
  seedB = makeDoc("doc-b", "Other");
  useDocumentStore.setState({ documents: [seedA, seedB], activeDocumentId: "doc-a" });
}

function docA(): Document | undefined {
  return useDocumentStore.getState().documents.find((d) => d.id === "doc-a");
}
function docB(): Document | undefined {
  return useDocumentStore.getState().documents.find((d) => d.id === "doc-b");
}

/** Counts emissions where doc-a's reference changed, and the content values written. */
function watchOwner(id = "doc-a") {
  const state = { emissions: 0, contents: [] as string[] };
  const unsub = useDocumentStore.subscribe((s, prev) => {
    const next = s.documents.find((d) => d.id === id);
    const before = prev.documents.find((d) => d.id === id);
    if (next !== before) {
      state.emissions += 1;
      if (next && next.content !== before?.content) state.contents.push(next.content);
    }
  });
  unsubs.push(unsub);
  return state;
}

function getMarkdown(): string {
  serializeCount += 1;
  if (throwNext) {
    throwNext = false;
    throw new Error("serializer failure");
  }
  return current;
}

function makeController(baseline = "Hello"): EditSyncController {
  return createEditSyncController({
    documentId: "doc-a",
    getMarkdown,
    baselineMarkdown: baseline,
    delayMs: DELAY,
  });
}

function flushCalls(): Array<Record<string, unknown>> {
  return logEventSyncMock.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((p) => p.event === FLUSH_EVENT);
}

beforeEach(() => {
  vi.useFakeTimers();
  logEventSyncMock.mockReset();
  current = "Hello";
  throwNext = false;
  serializeCount = 0;
  resetStore();
});

afterEach(() => {
  while (unsubs.length) unsubs.pop()?.();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("createEditSyncController — timer path", () => {
  it("C1 one user change is written after the delay, only to the owner", () => {
    const ctl = makeController();
    current = "Hello XYZ";
    ctl.onDocChanged({ userEdit: true });
    vi.advanceTimersByTime(DELAY);
    expect({ content: docA()?.content, isModified: docA()?.isModified }).toEqual({
      content: "Hello XYZ",
      isModified: true,
    });
    expect(docB()).toBe(seedB);
  });

  it("C2 dirty is marked synchronously, content is not", () => {
    const ctl = makeController();
    current = "Hello XYZ";
    ctl.onDocChanged({ userEdit: true });
    expect(docA()?.isModified).toBe(true);
    expect(docA()?.content).toBe("Hello");
  });

  it("C3 delay boundary at DELAY-1 / DELAY", () => {
    const ctl = makeController();
    current = "Hello XYZ";
    ctl.onDocChanged({ userEdit: true });
    vi.advanceTimersByTime(DELAY - 1);
    expect(docA()?.content).toBe("Hello");
    vi.advanceTimersByTime(1);
    expect(docA()?.content).toBe("Hello XYZ");
  });

  it("C4 no per-keystroke churn when already dirty", () => {
    resetStore(true);
    const ctl = makeController();
    const w = watchOwner();
    for (let i = 0; i < 10; i++) {
      current += "x";
      ctl.onDocChanged({ userEdit: true });
    }
    expect(w.emissions).toBe(0);
    vi.advanceTimersByTime(DELAY);
    expect(w.emissions).toBe(1);
  });

  it("C5 clean load leaves the document untouched", () => {
    const w = watchOwner();
    makeController();
    vi.runAllTimers();
    expect(docA()).toBe(seedA);
    expect(docA()?.isModified).toBe(false);
    expect(w.emissions).toBe(0);
  });

  it("C6 history-less change with markdown equal to the baseline is not written", () => {
    const ctl = makeController();
    for (let i = 0; i < 3; i++) ctl.onDocChanged({ userEdit: false });
    vi.advanceTimersByTime(DELAY);
    expect(ctl.flush("save")).toEqual({ status: "clean" });
    expect(docA()).toBe(seedA);
    expect(docA()?.isModified).toBe(false);
  });

  it("C7 history-less change with different markdown is written and dirties only at write time", () => {
    const ctl = makeController();
    current = "Hello MCP";
    ctl.onDocChanged({ userEdit: false });
    expect(docA()?.isModified).toBe(false);
    expect(docA()?.content).toBe("Hello");
    vi.advanceTimersByTime(DELAY);
    expect(docA()?.content).toBe("Hello MCP");
    expect(docA()?.isModified).toBe(true);
  });

  it("C9 coalesces 50 changes into one write and one serialization, single timer handle", () => {
    const ctl = makeController();
    const w = watchOwner();
    const timerCounts: number[] = [];
    for (let i = 1; i <= 50; i++) {
      current = `Hello ${i}`;
      ctl.onDocChanged({ userEdit: true });
      timerCounts.push(vi.getTimerCount());
      vi.advanceTimersByTime(10);
    }
    expect(Math.max(...timerCounts)).toBeLessThanOrEqual(1);
    expect(serializeCount).toBe(0);
    vi.advanceTimersByTime(DELAY - 10 - 1);
    expect(serializeCount).toBe(0);
    expect(w.contents.length).toBe(0);
    vi.advanceTimersByTime(1);
    expect(w.contents.length).toBe(1);
    expect(serializeCount).toBe(1);
    expect(docA()?.content).toBe("Hello 50");
  });
});

describe("createEditSyncController — flush", () => {
  it("C8 flush with no change is clean and emits nothing", () => {
    const ctl = makeController();
    const w = watchOwner();
    expect(ctl.flush("save")).toEqual({ status: "clean" });
    expect(w.emissions).toBe(0);
    expect(docA()).toBe(seedA);
  });

  it("C10 flush is synchronous, writes the latest markdown and cancels the timer", () => {
    const ctl = makeController();
    current = "Hello A";
    ctl.onDocChanged({ userEdit: true });
    expect(ctl.flush("save")).toEqual({ status: "written" });
    expect(docA()?.content).toBe("Hello A");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("C11 writes go to the bound document, never the active one", () => {
    const ctl = makeController();
    useDocumentStore.setState({ activeDocumentId: "doc-b" });
    current = "Hello A";
    ctl.onDocChanged({ userEdit: true });
    ctl.flush("tab-switch");
    expect(docA()?.content).toBe("Hello A");
    expect(docB()).toBe(seedB);
  });

  it.each([1, 2, 3, 5])("C12 flush is idempotent (k=%i)", (k) => {
    resetStore();
    const ctl = makeController();
    const w = watchOwner();
    current = `Hello ${k}`;
    ctl.onDocChanged({ userEdit: true });
    const results = Array.from({ length: k }, () => ctl.flush("save").status);
    const expected = ["written", ...Array.from({ length: k - 1 }, () => "clean")];
    expect(results, `k=${k}`).toEqual(expected);
    expect(w.contents.length, `k=${k}`).toBe(1);
  });

  it("C13 a stale timer after flush writes nothing", () => {
    const ctl = makeController();
    const w = watchOwner();
    current = "A";
    ctl.onDocChanged({ userEdit: true });
    current = "B";
    ctl.onDocChanged({ userEdit: true });
    ctl.flush("save");
    useDocumentStore.getState().updateDocumentContent("doc-a", "FORMATTED");
    vi.advanceTimersByTime(1000);
    expect(docA()?.content).toBe("FORMATTED");
    expect(w.contents).toEqual(["B", "FORMATTED"]);
  });

  it("C14 serializer throws: flush fails without throwing and nothing is lost", () => {
    const ctl = makeController();
    current = "Hello E";
    ctl.onDocChanged({ userEdit: true });
    throwNext = true;
    let result: unknown;
    expect(() => {
      result = ctl.flush("save");
    }).not.toThrow();
    expect(result).toEqual({ status: "failed" });
    expect(docA()?.content).toBe("Hello");
    expect(docA()?.isModified).toBe(true);
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    current = "Hello R";
    expect(ctl.flush("save")).toEqual({ status: "written" });
    expect(docA()?.content).toBe("Hello R");
  });

  it("C15 destroy flushes once and then everything is a no-op", () => {
    const ctl = makeController();
    const w = watchOwner();
    current = "Hello D";
    ctl.onDocChanged({ userEdit: true });
    expect(ctl.destroy("unmount")).toEqual({ status: "written" });
    expect(docA()?.content).toBe("Hello D");
    current = "Hello X";
    expect(ctl.onDocChanged({ userEdit: true })).toEqual({ status: "destroyed" });
    expect(ctl.flush("save")).toEqual({ status: "destroyed" });
    expect(ctl.destroy("unmount")).toEqual({ status: "destroyed" });
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(docA()?.content).toBe("Hello D");
    expect(w.contents).toEqual(["Hello D"]);
  });

  it("C16 owner document closed: nothing happens, doc-a not resurrected", () => {
    const ctl = makeController();
    current = "Hello C";
    ctl.onDocChanged({ userEdit: true });
    useDocumentStore.setState({ documents: [seedB], activeDocumentId: "doc-b" });
    let emissions = 0;
    unsubs.push(useDocumentStore.subscribe(() => (emissions += 1)));
    let result: { status: string } | undefined;
    expect(() => {
      result = ctl.flush("tab-close");
    }).not.toThrow();
    expect(result?.status).not.toBe("written");
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(useDocumentStore.getState().documents).toEqual([seedB]);
    expect(emissions).toBe(0);
  });
});

describe("createEditSyncController — log contract", () => {
  it("C17 keys, reasons, outcomes; timer ticks silent; never document text or length", () => {
    const SECRET = "SECRET-TEXT-42";
    const allCalls: unknown[] = [];
    const harvest = () => {
      allCalls.push(...logEventSyncMock.mock.calls);
      logEventSyncMock.mockClear();
    };

    // (i) change + advance: silent
    let ctl = makeController();
    current = SECRET;
    ctl.onDocChanged({ userEdit: true });
    vi.advanceTimersByTime(DELAY);
    expect(docA()?.content).toBe(SECRET);
    expect(flushCalls()).toEqual([]);
    harvest();

    // (ii) change + flush("save") → one call, exact keys
    resetStore();
    ctl = makeController();
    ctl.onDocChanged({ userEdit: true });
    ctl.flush("save");
    const ii = flushCalls();
    expect(ii).toHaveLength(1);
    const ctx = ii[0].context as Record<string, unknown>;
    expect(Object.keys(ctx).sort()).toEqual(["documentId", "outcome", "reason"]);
    expect(ctx).toEqual({ reason: "save", outcome: "written", documentId: "doc-a" });
    harvest();

    // (iii) serializer throws + flush("view-mode") → warn / fail
    resetStore();
    ctl = makeController();
    ctl.onDocChanged({ userEdit: true });
    throwNext = true;
    ctl.flush("view-mode");
    const iii = flushCalls();
    expect(iii).toHaveLength(1);
    expect(iii[0]).toMatchObject({ level: "warn", status: "fail" });
    expect((iii[0].context as Record<string, unknown>).reason).toBe("view-mode");
    expect(Object.keys(iii[0].context as object).sort()).toEqual([
      "documentId",
      "outcome",
      "reason",
    ]);
    harvest();

    // (iv) destroy("unmount") → one call with reason unmount
    resetStore();
    ctl = makeController();
    ctl.onDocChanged({ userEdit: true });
    ctl.destroy("unmount");
    const iv = flushCalls();
    expect(iv).toHaveLength(1);
    expect((iv[0].context as Record<string, unknown>).reason).toBe("unmount");
    harvest();

    const json = JSON.stringify(allCalls);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(String(SECRET.length));
  });
});

describe("createEditSyncController — C18 model-checked random sequences", () => {
  const SEEDS = 200;
  const OPS_PER_SEED = 40;
  const ADVANCES = [0, 50, 199, 200, 400];

  it("laws L-C1, L-C3, L-C4, L-C5 hold after every op", () => {
    const totals = { written: 0, failed: 0, postDestroyOps: 0, timerWrites: 0 };

    for (let s = 0; s < SEEDS; s++) {
      resetStore();
      current = "Hello";
      throwNext = false;
      const rand = createLcg(DEFAULT_SEED + s);
      let tokenN = 0;
      const fresh = () => `tok-${s}-${tokenN++}`;
      const returned = new Set<string>(["Hello"]);
      const externals = new Set<string>();
      const serializer = () => {
        if (throwNext) {
          throwNext = false;
          throw new Error("serializer failure");
        }
        returned.add(current);
        return current;
      };
      const ctl = createEditSyncController({
        documentId: "doc-a",
        getMarkdown: serializer,
        baselineMarkdown: "Hello",
        delayMs: DELAY,
      });

      // reference model
      let destroyed = false;
      let pendingUser = false;
      let changeSinceExternal = false;
      let lastWritten = "Hello";
      let changesSinceWrite = 0;
      let inExternal = false;
      let currentOp = "";
      let step = 0;
      let lastWriteViolation: string | null = null;

      const unsub = useDocumentStore.subscribe((st, prev) => {
        if (inExternal) return;
        const next = st.documents.find((d) => d.id === "doc-a");
        const before = prev.documents.find((d) => d.id === "doc-a");
        if (next === before || !next || !before) return;
        const isDirtyFlip =
          next.content === before.content && !before.isModified && next.isModified;
        if (isDirtyFlip) return;
        // a controller content write
        if (changesSinceWrite === 0 && lastWriteViolation === null) {
          lastWriteViolation = `I5 write with zero changes seed=${s} step=${step} op=${currentOp}`;
        }
        changesSinceWrite = 0;
        lastWritten = next.content;
        if (currentOp.startsWith("advance")) totals.timerWrites += 1;
      });

      for (step = 0; step < OPS_PER_SEED; step++) {
        const r = rand() % 40;
        const refBefore = docA();
        let op: string;
        let status: string | undefined;
        if (r === 0 && !destroyed) op = "destroy";
        else if (r <= 9) op = "userEdit";
        else if (r <= 15) op = "progEdit";
        else if (r <= 25) op = `advance(${ADVANCES[rand() % ADVANCES.length]})`;
        else if (r <= 32) op = "flush";
        else if (r <= 35) op = "throwNext";
        else op = "externalWrite";
        currentOp = op;
        const msg = `seed=${s} step=${step} op=${op}`;
        const wasDestroyed = destroyed;

        try {
          if (op === "userEdit") {
            current = fresh();
            ctl.onDocChanged({ userEdit: true });
            if (!destroyed) {
              pendingUser = true;
              changeSinceExternal = true;
              changesSinceWrite += 1;
            }
          } else if (op === "progEdit") {
            current = rand() % 2 === 0 ? lastWritten : fresh();
            ctl.onDocChanged({ userEdit: false });
            if (!destroyed) {
              changeSinceExternal = true;
              changesSinceWrite += 1;
            }
          } else if (op.startsWith("advance")) {
            const k = Number(op.slice(8, -1));
            vi.advanceTimersByTime(k);
          } else if (op === "flush") {
            status = ctl.flush("save").status;
          } else if (op === "destroy") {
            status = ctl.destroy("unmount").status;
            destroyed = true;
          } else if (op === "throwNext") {
            throwNext = true;
          } else {
            const token = fresh();
            externals.add(token);
            inExternal = true;
            useDocumentStore.getState().updateDocumentContent("doc-a", token);
            inExternal = false;
            changeSinceExternal = false;
          }
        } catch (error) {
          inExternal = false;
          const m = error instanceof Error ? error.message : String(error);
          throw new Error(`I6 op threw (${m}) ${msg}`);
        }

        if (wasDestroyed) {
          totals.postDestroyOps += 1;
          if (op !== "externalWrite") {
            expect(docA(), `I2 post-destroy write ${msg}`).toBe(refBefore);
          }
          if (status !== undefined) expect(status, `destroyed status ${msg}`).toBe("destroyed");
        }
        if (status === "written") totals.written += 1;
        if (status === "failed") totals.failed += 1;
        if ((status === "written" || status === "clean") && changeSinceExternal) {
          expect(docA()?.content, `I1 convergence ${msg}`).toBe(current);
        }
        if (status === "written" || status === "clean") pendingUser = false;
        if (pendingUser) expect(docA()?.isModified, `I3 dirtiness ${msg}`).toBe(true);
        const content = docA()?.content ?? "";
        expect(
          returned.has(content) || externals.has(content),
          `I4 invented content ${msg}`,
        ).toBe(true);
        expect(lastWriteViolation, `I5 ${msg}`).toBeNull();
      }
      unsub();
      ctl.destroy("unmount");
      vi.clearAllTimers();
    }

    expect(totals.written, "non-vacuity: written flushes").toBeGreaterThanOrEqual(200);
    expect(totals.failed, "non-vacuity: failed flushes").toBeGreaterThanOrEqual(50);
    expect(totals.postDestroyOps, "non-vacuity: post-destroy ops").toBeGreaterThanOrEqual(50);
    expect(totals.timerWrites, "non-vacuity: timer-path writes").toBeGreaterThanOrEqual(100);
  });
});
