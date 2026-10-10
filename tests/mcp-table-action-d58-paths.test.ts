/**
 * D58 WI-2: source mode and non-active targets. Outside the flush gate
 * (`isActive && viewMode === "wysiwyg"`, read before the flush), neither any document's
 * flusher nor the Milkdown editor changes the outcome; source success output stays
 * byte-identical (A5); a CodeMirror dispatch throw is logged, not thrown.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-131500.md`, "Unit: processTableActionEvent —
 * source mode and non-active targets (WI-2)". jsdom, a real CodeMirror `EditorView`; only
 * `invoke` is mocked. Every case ends with D58-7 and D58-7b.
 *
 * Mutation proof (matrix r4):
 * | Mutant                                                          | Fails  |
 * | "Flush in every mode"                                           | S2, S3 |
 * | "Flush gated on viewMode === wysiwyg only" (non-active target)  | N3 only |
 * | "Milkdown branch gated on viewMode only"                        | N1     |
 * | "Branch on editorView === null"                                 | S3     |
 * | "isWysiwygActive from isActive only"                            | S2, S3 |
 * N1 does NOT kill the viewMode-only flush gate: its flusher sits on doc-a while the target
 * is doc-b, which has none, so a target-only flush returns clean. N3 kills it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState as CmState } from "@codemirror/state";
import { EditorView as CmView } from "@codemirror/view";
import { processTableActionEvent, type TableActionEvent } from "../src/hooks/mcpTableAction";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import {
  A,
  DOCB,
  EV,
  F,
  P,
  TYPED,
  allLogs,
  assertPreconditions,
  bindInvoke,
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
  snapshot,
  successLog,
  tableEvt,
  tableLogs,
} from "./helpers/mcpTableD58Fixture";

const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
);

const EV_B = tableEvt({ document_id: "doc-b" });
const B = (x: string) => A(x, EV_B);
const FLUSH_FAIL = () => {
  throw new Error("D58 flusher failure");
};

let cm: CmView | null = null;

function run(e: TableActionEvent): void {
  expect(() => processTableActionEvent(e, deps)).not.toThrow();
}

/** D58-N2 (never wholesale) runs inside every case, then D58-7 and D58-7b. */
function finish(): void {
  expect(gen("doc-a")).toBe(0);
  expect(gen("doc-b")).toBe(0);
  expect(logs("editor.milkdown.reload")).toEqual([]);
  expectNoSentinelInLogs();
  expectClosedLogWorld(["set_cell"]);
}

function sourceWithView(text: string): CmView {
  cm = new CmView({ state: CmState.create({ doc: text }) });
  useEditorStore.setState({ viewMode: "source", editorView: cm });
  return cm;
}

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
  useEditorStore.setState({ editorView: null });
  vi.useRealTimers();
});

describe("D58 WI-2: source mode and non-active targets", () => {
  it("D58-S1 source mode, live view: store and view equal A(F), and the log stream is exactly today's", () => {
    const view = sourceWithView(F);
    const fake = fakeEditor("ok", F);
    run(EV);

    expect(snapshot("doc-a")).toEqual({ content: A(F), isModified: true });
    expect(view.state.doc.toString()).toBe(A(F));
    expect(fake.parseCalls).toBe(0);
    expect(fake.dispatchCalls).toBe(0);
    expect(allLogs()).toEqual([successLog("set_cell", "doc-a")]);
    finish();
  });

  it("D58-S2 source mode ignores a failing flusher", () => {
    pending("doc-a", FLUSH_FAIL);
    const view = sourceWithView(F);
    const fake = fakeEditor("ok", F);
    run(EV);

    expect(snapshot("doc-a")).toEqual({ content: A(F), isModified: true });
    expect(view.state.doc.toString()).toBe(A(F));
    expect(fake.parseCalls).toBe(0);
    expect(fake.dispatchCalls).toBe(0);
    expect(logs("editor.milkdown.flush")).toEqual([]);
    expect(allLogs()).toEqual([successLog("set_cell", "doc-a")]);
    finish();
  });

  it("D58-S3 source mode with no view and a pending flusher does not flush", () => {
    useEditorStore.setState({ viewMode: "source", editorView: null });
    pending("doc-a", () => P);
    run(EV);

    expect(content("doc-a")).toBe(A(F));
    expect(content("doc-a")).not.toContain(TYPED.trim());
    expect(logs("editor.milkdown.flush")).toEqual([]);
    expect(tableLogs()).toEqual([successLog("set_cell", "doc-a")]);
    finish();
  });

  it("D58-S4 cmView.dispatch throws: fail log, nothing escapes, store-first kept", () => {
    const stub = {
      state: CmState.create({ doc: F }),
      dispatch: () => {
        throw new Error("D58 cm dispatch failure");
      },
    };
    useEditorStore.setState({ viewMode: "source", editorView: stub as unknown as CmView });
    run(EV);

    expect(snapshot("doc-a")).toEqual({ content: A(F), isModified: true });
    expect(tableLogs()).toEqual([
      failLog("set_cell", {
        documentId: "doc-a",
        reason: "codemirror dispatch threw",
        error: "D58 cm dispatch failure",
      }),
    ]);
    finish();
  });

  it("D58-N1 a non-active target leaves the active WYSIWYG document, its flusher and the editor alone", () => {
    pending("doc-a", FLUSH_FAIL);
    const fake = fakeEditor("ok", F);
    const snapA = snapshot("doc-a");
    run(EV_B);

    expect(snapshot("doc-b")).toEqual({ content: B(DOCB), isModified: true });
    expect(snapshot("doc-a")).toEqual(snapA);
    expect(fake.parseCalls).toBe(0);
    expect(fake.dispatchCalls).toBe(0);
    expect(logs("editor.milkdown.flush")).toEqual([]);
    expect(tableLogs()).toEqual([successLog("set_cell", "doc-b")]);
    finish();
  });

  it("D58-N3 a non-active target's own flusher is never invoked, even in WYSIWYG mode", () => {
    for (const sub of ["i", "ii"] as const) {
      resetTableFixture({ docA: F, docB: DOCB, active: "doc-a", viewMode: "wysiwyg" });
      invoke.mockClear();
      const fake = fakeEditor("ok", F);
      let calls = 0;
      if (sub === "i")
        customFlusher("doc-b", () => {
          calls++;
          throw new Error("D58 doc-b flusher");
        });
      else pending("doc-b", () => DOCB + TYPED);
      const snapA = snapshot("doc-a");
      run(EV_B);

      expect(snapshot("doc-b"), sub).toEqual({ content: B(DOCB), isModified: true });
      expect(logs("editor.milkdown.flush"), sub).toEqual([]);
      expect(tableLogs(), sub).toEqual([successLog("set_cell", "doc-b")]);
      expect(snapshot("doc-a"), sub).toEqual(snapA);
      expect(fake.parseCalls, sub).toBe(0);
      expect(fake.dispatchCalls, sub).toBe(0);
      expect(calls, sub).toBe(0);
      expect(flushContexts().filter((c) => c?.outcome === "written"), sub).toEqual([]);
      finish();
    }
  });

  it("D58-N2 a table action is never wholesale (sweep over the WI-2 arrangements)", () => {
    const scenarios: Array<[TableActionEvent, () => void]> = [
      [EV, () => sourceWithView(F)],
      [EV, () => (pending("doc-a", () => P), useEditorStore.setState({ viewMode: "source" }))],
      [EV_B, () => (pending("doc-a", FLUSH_FAIL), fakeEditor("ok", F))],
      [EV_B, () => (pending("doc-b", () => DOCB + TYPED), fakeEditor("ok", F))],
      [EV, () => fakeEditor("ok", F)],
    ];
    const bad: string[] = [];
    for (const [i, [e, arrange]] of scenarios.entries()) {
      resetTableFixture({ docA: F, docB: DOCB, active: "doc-a", viewMode: "wysiwyg" });
      invoke.mockClear();
      arrange();
      processTableActionEvent(e, deps);
      if (gen("doc-a") !== 0 || gen("doc-b") !== 0) bad.push(`scenario ${i}: generation bumped`);
      if (logs("editor.milkdown.reload").length) bad.push(`scenario ${i}: reload logged`);
      cm?.destroy();
      cm = null;
    }
    expect(bad).toEqual([]);
  });
});
