/**
 * D58 WI-1a: `processTableActionEvent` flushes the target's pending WYSIWYG edit first,
 * only that target, after the window-label guard, and decides the branch on post-flush
 * state (amendment A2/A3).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-131500.md`, "Unit: hooks/mcpTableAction
 * #processTableActionEvent — flush, scope, re-read (WI-1a)". Only `@tauri-apps/api/core`
 * `invoke` is mocked (C1); logs are read as `log_event` calls. The Milkdown editor is the
 * §0.6 fake over a real ProseMirror state, and the real `replaceAll` runs against it.
 * Fake timers, never advanced (§0.4). Every case ends with D58-7 and D58-7b.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState as CmState } from "@codemirror/state";
import { EditorView as CmView } from "@codemirror/view";
import { processTableActionEvent, type TableActionEvent } from "../src/hooks/mcpTableAction";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import {
  A,
  DEL_99,
  DOCB,
  EV,
  F,
  P,
  TYPED,
  allLogs,
  assertPreconditions,
  bindInvoke,
  closedWorldViolations,
  content,
  customFlusher,
  deps,
  expectClosedLogWorld,
  expectNoSentinelInLogs,
  failLog,
  fakeEditor,
  flushContexts,
  gen,
  logs,
  pending,
  resetTableFixture,
  sentinelViolations,
  snapshot,
  successLog,
  tableEvt,
  tableLogs,
} from "./helpers/mcpTableD58Fixture";

const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
);

/** Drive one event; the call must never throw. */
function run(e: TableActionEvent): void {
  expect(() => processTableActionEvent(e, deps)).not.toThrow();
}

function finish(action = "set_cell"): void {
  expectNoSentinelInLogs();
  expectClosedLogWorld([action]);
}

const FLUSH_FAIL = () => {
  throw new Error("D58 flusher failure");
};

let cm: CmView | null = null;

beforeAll(() => {
  bindInvoke(invoke);
  assertPreconditions();
});

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockClear();
  useLoggingStore.setState({ enabled: true, level: "info" });
  resetTableFixture({ docA: F, docB: DOCB, active: "doc-a", viewMode: "wysiwyg" });
});

afterEach(() => {
  cm?.destroy();
  cm = null;
  vi.useRealTimers();
});

describe("D58 WI-1a: flush, scope, re-read", () => {
  it("D58-1 a pending WYSIWYG edit survives a set_cell", () => {
    pending("doc-a", () => P);
    const fake = fakeEditor("ok", P);
    const snapB = snapshot("doc-b");
    run(EV);

    expect(snapshot("doc-a")).toEqual({ content: A(P), isModified: true });
    expect(gen("doc-a")).toBe(0);
    expect(snapshot("doc-b")).toEqual(snapB);
    expect(fake.viewText()).toBe(A(P));
    expect(fake.dispatchCalls).toBe(1);
    expect(fake.storeAtDispatch[0]?.content).toBe(P);
    expect(flushContexts()).toEqual([{ reason: "mcp-table", documentId: "doc-a", outcome: "written" }]);
    expect(tableLogs()).toEqual([successLog("set_cell", "doc-a")]);
    expect(logs("editor.milkdown.reload")).toEqual([]);
    finish();
  });

  it("D58-2 a failed target flush refuses", () => {
    pending("doc-a", FLUSH_FAIL);
    const fake = fakeEditor("ok", F);
    const snapA = snapshot("doc-a");
    expect(snapA).toEqual({ content: F, isModified: true });
    run(EV);

    expect(snapshot("doc-a")).toEqual(snapA);
    expect(fake.dispatchCalls).toBe(0);
    expect(fake.parseCalls).toBe(0);
    expect(tableLogs()).toEqual([failLog("set_cell", { documentId: "doc-a", reason: "flush failed" })]);
    finish();
  });

  it("D58-3b a successful flush, then a throw before the view advances", () => {
    pending("doc-a", () => P);
    const fake = fakeEditor("parseThrows", P);
    run(EV);

    expect(snapshot("doc-a")).toEqual({ content: P, isModified: true });
    expect(fake.viewDoc()).toBe(fake.docBefore);
    expect(flushContexts()).toEqual([{ reason: "mcp-table", documentId: "doc-a", outcome: "written" }]);
    expect(tableLogs()).toEqual([
      failLog("set_cell", {
        documentId: "doc-a",
        reason: "milkdown replaceAll threw",
        error: "D58 simulated parser failure",
      }),
    ]);
    finish();
  });

  it("D58-5 WYSIWYG-active with no editor is refused", () => {
    // (a) no flusher, getEditor → null
    run(EV);
    expect(snapshot("doc-a")).toEqual({ content: F, isModified: false });
    expect(tableLogs()).toEqual([failLog("set_cell", { documentId: "doc-a", reason: "editor unavailable" })]);
    finish();

    // (b) the same with a pending edit
    resetTableFixture({ docA: F, docB: DOCB });
    invoke.mockClear();
    pending("doc-a", () => P);
    run(EV);
    expect(snapshot("doc-a")).toEqual({ content: P, isModified: true });
    expect(tableLogs()).toEqual([failLog("set_cell", { documentId: "doc-a", reason: "editor unavailable" })]);
    finish();
  });

  it("D58-6 an invalid payload after a successful flush", () => {
    pending("doc-a", () => P);
    const fake = fakeEditor("ok", P);
    run(DEL_99);

    expect(snapshot("doc-a")).toEqual({ content: P, isModified: true });
    expect(fake.parseCalls).toBe(0);
    expect(fake.dispatchCalls).toBe(0);
    expect(flushContexts()).toEqual([{ reason: "mcp-table", documentId: "doc-a", outcome: "written" }]);
    expect(tableLogs()).toEqual([failLog("delete_row", { documentId: "doc-a", reason: "invalid payload" })]);
    finish("delete_row");
  });

  it("D58-7 no cell text, payload or pending text reaches a log (sweep)", () => {
    const scenarios: Array<() => void> = [
      () => (pending("doc-a", () => P), fakeEditor("ok", P)),
      () => (pending("doc-a", FLUSH_FAIL), fakeEditor("ok", F)),
      () => fakeEditor("parseThrows", F),
      () => fakeEditor("throwAfterDispatch", F),
      () => undefined,
    ];
    const bad: string[] = [];
    for (const [i, arrange] of scenarios.entries()) {
      resetTableFixture({ docA: F, docB: DOCB });
      invoke.mockClear();
      arrange();
      processTableActionEvent(EV, deps);
      bad.push(...sentinelViolations().map((v) => `scenario ${i}: ${v}`));
    }
    expect(bad).toEqual([]);
  });

  it("D58-7b closed-world log stream (sweep)", () => {
    const scenarios: Array<[TableActionEvent, () => void]> = [
      [EV, () => (pending("doc-a", () => P), fakeEditor("ok", P))],
      [EV, () => (pending("doc-a", FLUSH_FAIL), fakeEditor("ok", F))],
      [EV, () => fakeEditor("parseThrows", F)],
      [DEL_99, () => fakeEditor("ok", F)],
      [tableEvt({ document_id: "doc-missing" }), () => undefined],
      [tableEvt({ window_label: "other-window" }), () => undefined],
    ];
    const bad: string[] = [];
    for (const [i, [e, arrange]] of scenarios.entries()) {
      resetTableFixture({ docA: F, docB: DOCB });
      invoke.mockClear();
      arrange();
      processTableActionEvent(e, deps);
      bad.push(...closedWorldViolations([e.action]).map((v) => `scenario ${i}: ${v}`));
    }
    expect(bad).toEqual([]);
  });

  it("D58-8b target-only flush: another tab's pending or throwing flusher is never invoked", () => {
    for (const sub of ["a", "b"] as const) {
      resetTableFixture({ docA: F, docB: DOCB });
      invoke.mockClear();
      let calls = 0;
      if (sub === "a") pending("doc-b", () => DOCB + TYPED);
      else
        customFlusher("doc-b", () => {
          calls++;
          throw new Error("D58 doc-b flusher");
        });
      const fake = fakeEditor("ok", F);
      const snapB = snapshot("doc-b");
      run(EV);

      expect(snapshot("doc-b"), sub).toEqual(snapB);
      expect(snapshot("doc-a"), sub).toEqual({ content: A(F), isModified: true });
      expect(fake.viewText(), sub).toBe(A(F));
      expect(tableLogs(), sub).toEqual([successLog("set_cell", "doc-a")]);
      expect(flushContexts().filter((c) => c?.documentId === "doc-b"), sub).toEqual([]);
      expect(allLogs().filter((p) => p.status === "fail"), sub).toEqual([]);
      expect(calls, sub).toBe(0);
      finish();
    }
  });

  it("D58-9 the window-label guard runs before the flush", () => {
    pending("doc-a", () => P);
    const fake = fakeEditor("ok", P);
    run(tableEvt({ window_label: "other-window" }));

    expect(content("doc-a")).toBe(F);
    expect(allLogs()).toEqual([]);
    expect(fake.parseCalls).toBe(0);
    expect(fake.dispatchCalls).toBe(0);
    finish();
  });

  it("D58-10 an unknown target does not flush", () => {
    pending("doc-a", () => P);
    fakeEditor("ok", P);
    run(tableEvt({ document_id: "doc-missing" }));

    expect(content("doc-a")).toBe(F);
    expect(logs("editor.milkdown.flush")).toEqual([]);
    expect(tableLogs()).toEqual([failLog("set_cell", { documentId: "doc-missing", reason: "not found" })]);
    finish();
  });

  it("D58-R1 the branch is decided on the post-flush viewMode", () => {
    const fake = fakeEditor("ok", P);
    cm = new CmView({ state: CmState.create({ doc: P }) });
    const view = cm;
    customFlusher("doc-a", () => {
      useDocumentStore.getState().updateDocumentContent("doc-a", P);
      useEditorStore.setState({ viewMode: "source", editorView: view });
      return { status: "written" };
    });
    run(EV);

    expect(view.state.doc.toString()).toBe(A(P));
    expect(content("doc-a")).toBe(A(P));
    expect(fake.parseCalls).toBe(0);
    expect(fake.dispatchCalls).toBe(0);
    expect(tableLogs()).toEqual([successLog("set_cell", "doc-a")]);
    finish();
  });

  it("D58-R2 the branch is decided on the post-flush activeDocumentId", () => {
    const fake = fakeEditor("ok", P);
    const snapB = snapshot("doc-b");
    customFlusher("doc-a", () => {
      useDocumentStore.getState().updateDocumentContent("doc-a", P);
      useDocumentStore.setState({ activeDocumentId: "doc-b" });
      return { status: "written" };
    });
    run(EV);

    expect(content("doc-a")).toBe(A(P));
    expect(fake.parseCalls).toBe(0);
    expect(fake.dispatchCalls).toBe(0);
    expect(tableLogs()).toEqual([successLog("set_cell", "doc-a")]);
    expect(snapshot("doc-b")).toEqual(snapB);
    finish();
  });

  it("D58-R3 the editor getter is re-read after the flush", () => {
    const fake = fakeEditor("ok", P);
    customFlusher("doc-a", () => {
      useDocumentStore.getState().updateDocumentContent("doc-a", P);
      useMilkdownEditorStore.setState({ getEditor: () => null });
      return { status: "written" };
    });
    run(EV);

    expect(snapshot("doc-a")).toEqual({ content: P, isModified: true });
    expect(fake.dispatchCalls).toBe(0);
    expect(tableLogs()).toEqual([failLog("set_cell", { documentId: "doc-a", reason: "editor unavailable" })]);
    finish();
  });
});
