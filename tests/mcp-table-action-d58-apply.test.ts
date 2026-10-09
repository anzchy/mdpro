/**
 * D58 WI-1b (amendment A4): the phased Milkdown apply. The editor is committed while the
 * store still holds the base; a parse that yields nothing, a dispatch the view drops, and a
 * throw before the view advances are refused with the store untouched; an identical parsed
 * doc is a legitimate no-op; a throw after the view advanced reconciles the store to the
 * editor.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-131500.md`, "Unit: processTableActionEvent —
 * phased Milkdown apply (WI-1b)" plus the r5 addendum (P2c). Every case is WYSIWYG-active on
 * doc-a = F with no flusher unless stated, ends with D58-7 and D58-7b, and asserts the call
 * does not throw. Only `invoke` is mocked; the §0.6 fake editor runs the real `replaceAll`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processTableActionEvent, type TableActionEvent } from "../src/hooks/mcpTableAction";
import { useLoggingStore } from "../src/stores/loggingStore";
import {
  A,
  DOCB,
  EV,
  F,
  P,
  Rp,
  SAME,
  allLogs,
  assertPreconditions,
  bindInvoke,
  canon,
  deps,
  expectClosedLogWorld,
  expectNoSentinelInLogs,
  failLog,
  fakeEditor,
  gen,
  pending,
  resetTableFixture,
  snapshot,
  successLog,
  tableLogs,
  type FakeMode,
} from "./helpers/mcpTableD58Fixture";

const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
);

const THREW = "milkdown replaceAll threw";

function run(e: TableActionEvent): void {
  expect(() => processTableActionEvent(e, deps)).not.toThrow();
}

function finish(): void {
  expectNoSentinelInLogs();
  expectClosedLogWorld(["set_cell"]);
}

/** Fresh fixture for one sub-case; `withPending` arranges `pending("doc-a", () => P)`. */
function arrange(mode: FakeMode, withPending: boolean) {
  resetTableFixture({ docA: F, docB: DOCB });
  invoke.mockClear();
  if (withPending) pending("doc-a", () => P);
  return fakeEditor(mode, withPending ? P : F);
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
  vi.useRealTimers();
});

describe("D58 WI-1b: phased Milkdown apply", () => {
  it("D58-4 normal apply: the editor is committed while the store still holds base", () => {
    const fake = fakeEditor("ok", F);
    run(EV);

    expect(fake.storeAtDispatch[0]).toEqual({ content: F, isModified: false });
    expect(snapshot("doc-a")).toEqual({ content: A(F), isModified: true });
    expect(fake.viewText()).toBe(A(F));
    expect(fake.dispatchCalls).toBe(1);
    expect(fake.parseCalls).toBe(2);
    expect(tableLogs()).toEqual([successLog("set_cell", "doc-a")]);
    finish();
  });

  it("D58-P1 the parser yields no doc: refuse, no store write, no replaceAll", () => {
    const fake = fakeEditor("parseNull", F);
    run(EV);

    expect(snapshot("doc-a")).toEqual({ content: F, isModified: false });
    expect(fake.viewDoc()).toBe(fake.docBefore);
    expect(fake.dispatchCalls).toBe(0);
    expect(fake.parseCalls).toBe(1);
    expect(tableLogs()).toEqual([failLog("set_cell", { documentId: "doc-a", reason: "editor did not apply" })]);
    finish();
  });

  it("D58-P2 an identical result is a legitimate no-op: success, no dispatch, store written", () => {
    const fake = fakeEditor("ok", F);
    run(SAME);

    expect(fake.dispatchCalls).toBe(0);
    expect(fake.viewDoc()).toBe(fake.docBefore);
    expect(snapshot("doc-a")).toEqual({ content: F, isModified: true });
    expect(tableLogs()).toEqual([successLog("set_cell", "doc-a")]);
    finish();
  });

  it("D58-P2b identity by parsed doc, not by text: a whitespace-only difference is still a no-op", () => {
    resetTableFixture({ docA: Rp, docB: DOCB });
    const fake = fakeEditor("collapseWs", Rp);
    run(SAME);

    expect(fake.dispatchCalls).toBe(0);
    expect(fake.viewDoc()).toBe(fake.docBefore);
    expect(snapshot("doc-a")).toEqual({ content: canon(Rp), isModified: true });
    expect(tableLogs()).toEqual([successLog("set_cell", "doc-a")]);
    finish();
  });

  it("D58-P2c the no-op is judged against the live view, not the store", () => {
    const fake = fakeEditor("ok", F + " D58-VIEW");
    run(SAME);

    expect(fake.dispatchCalls).toBe(1);
    expect(fake.viewText()).toBe(F);
    expect(fake.viewDoc()).not.toBe(fake.docBefore);
    expect(snapshot("doc-a")).toEqual({ content: F, isModified: true });
    expect(tableLogs()).toEqual([successLog("set_cell", "doc-a")]);
    finish();
  });

  it("D58-P3 replaceAll ran but the view did not change: refuse", () => {
    const fake = fakeEditor("dropDispatch", F);
    run(EV);

    expect(fake.dispatchCalls).toBe(1);
    expect(fake.viewDoc()).toBe(fake.docBefore);
    expect(snapshot("doc-a")).toEqual({ content: F, isModified: false });
    expect(tableLogs()).toEqual([failLog("set_cell", { documentId: "doc-a", reason: "editor did not apply" })]);
    finish();
  });

  it("D58-P4 a throw after the view advanced: the store is aligned to the serialized editor", () => {
    for (const withPending of [false, true]) {
      const sub = withPending ? "(b)" : "(a)";
      const base = withPending ? P : F;
      const fake = arrange("throwAfterDispatch", withPending);
      run(EV);

      expect(fake.viewText(), sub).toBe(A(base));
      expect(snapshot("doc-a"), sub).toEqual({ content: "SER:" + A(base), isModified: true });
      expect(fake.storeAtDispatch[0]?.content, sub).toBe(base);
      expect(tableLogs(), sub).toEqual([
        failLog("set_cell", {
          documentId: "doc-a",
          reason: THREW,
          error: "D58 simulated plugin view-update failure",
          storeReconciled: true,
        }),
      ]);
      expect(JSON.stringify(allLogs()), sub).not.toContain("SER:");
      expect(gen("doc-a"), sub).toBe(0);
      finish();
    }
  });

  it("D58-3 the parser throws before dispatch: store and editor unchanged", () => {
    const fake = fakeEditor("parseThrows", F);
    run(EV);

    expect(snapshot("doc-a")).toEqual({ content: F, isModified: false });
    expect(fake.viewDoc()).toBe(fake.docBefore);
    expect(fake.dispatchCalls).toBe(0);
    expect(tableLogs()).toEqual([
      failLog("set_cell", { documentId: "doc-a", reason: THREW, error: "D58 simulated parser failure" }),
    ]);
    finish();
  });

  it("D58-P5 dispatch throws before applying: no reconcile", () => {
    const fake = fakeEditor("throwInDispatch", F);
    run(EV);

    expect(fake.dispatchCalls).toBe(1);
    expect(fake.viewDoc()).toBe(fake.docBefore);
    expect(snapshot("doc-a")).toEqual({ content: F, isModified: false });
    expect(tableLogs()).toEqual([
      failLog("set_cell", { documentId: "doc-a", reason: THREW, error: "D58 simulated dispatch failure" }),
    ]);
    expect(JSON.stringify(allLogs())).not.toContain("SER:");
    finish();
  });

  it("D58-P6 getting the view throws (before `before` is captured): refuse, nothing escapes", () => {
    for (const withPending of [false, true]) {
      const sub = withPending ? "(b)" : "(a)";
      const fake = arrange("viewCtxThrows", withPending);
      run(EV);

      expect(snapshot("doc-a"), sub).toEqual(
        withPending ? { content: P, isModified: true } : { content: F, isModified: false },
      );
      expect(fake.parseCalls, sub).toBe(0);
      expect(fake.dispatchCalls, sub).toBe(0);
      expect(tableLogs(), sub).toEqual([
        failLog("set_cell", { documentId: "doc-a", reason: THREW, error: "D58 simulated view ctx failure" }),
      ]);
      finish();
    }
  });

  it("D58-P7 the view advanced, then the serializer also throws: fall back to newContent", () => {
    for (const withPending of [false, true]) {
      const sub = withPending ? "(b)" : "(a)";
      const base = withPending ? P : F;
      const fake = arrange("throwAfterDispatchSerializerThrows", withPending);
      run(EV);

      expect(fake.viewText(), sub).toBe(A(base));
      expect(snapshot("doc-a"), sub).toEqual({ content: A(base), isModified: true });
      expect(tableLogs(), sub).toEqual([
        failLog("set_cell", {
          documentId: "doc-a",
          reason: THREW,
          error: "D58 simulated plugin view-update failure",
          storeReconciled: true,
        }),
      ]);
      expect(JSON.stringify(allLogs()), sub).not.toContain("D58 simulated serializer failure");
      expect(gen("doc-a"), sub).toBe(0);
      finish();
    }
  });
});
