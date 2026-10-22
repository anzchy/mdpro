/**
 * D261-WI-1c: each native menu action reaches the one window Rust addressed,
 * and carries a token of that window's document state at receipt.
 *
 * Law (target routing): for any payload `p` delivered to a mount labelled `L`,
 * handlers run iff `p.target === L`; then exactly one dispatch happens and the
 * handler's token is `captureToken(L)` evaluated at receipt of `p`. Otherwise
 * exactly one `ui.menu.select` `cancel` line with
 * `{ windowLabel: L, reason: "wrong_target" }` is written and nothing runs.
 * The D31 laws (one subscription per mount, none after unmount) still hold.
 *
 * Mock boundary: the Tauri modules only, through
 * `tests/support/menuEventsHarness.ts`: the window mock's `listen` is a
 * label-routed in-memory bus (Rust's `emit_to`), the event module's global
 * `listen` is an `Any` listener that hears every emit, and `invoke` captures
 * `log_event`. The stores, `loggingService` and the hook are real.
 * Paired real path: the WI-5 device items DB-1 to DB-6 (two real windows).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./support/menuEventsHarness")).eventModuleMock());
vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { getCurrentWindow } from "@tauri-apps/api/window";
import { getEditorGeneration } from "../src/stores/editorGeneration";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { bus, win } from "./support/menuEventsHarness";
import {
  callTokens,
  calls,
  EVT,
  flush,
  makeHandlers,
  menuLogs,
  mountHook,
  payloadOf,
  resetMenuHarness,
  ROWS,
  uiMenuLines,
} from "./support/menuEventsDomain";
import { applyGenEvent, newView, seedStores, type GenEvent, type Shadow } from "./support/editorGenerationDomain";
import { genSequence, mulberry32 } from "./support/seededSequences";
import { collectionCases } from "./support/collectionCases";

let shadow: Shadow;

beforeEach(() => {
  resetMenuHarness();
  shadow = seedStores();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Mount the hook as window `label` with recording handlers of generation `gen`. */
const mountAs = async (label: string, gen: number) => {
  win.label = label;
  const h = mountHook(makeHandlers(gen));
  await flush();
  return h;
};

const wrongTargetLine = (label: string) => ({
  level: "info",
  event: "ui.menu.select",
  status: "cancel",
  actionId: expect.any(String),
  context: { windowLabel: label, reason: "wrong_target" },
});

describe("two windows: only the addressed one acts (S1)", () => {
  it("emitTo(B, file.save) runs B's onSave once with B's token, and A neither acts nor logs", async () => {
    const a = await mountAs("A", 1);
    const b = await mountAs("B", 2);
    const g = getEditorGeneration();

    bus.emitTo("B", EVT, { action: "file.save", target: "B" });
    await flush();

    expect(calls).toEqual([{ gen: 2, key: "onSave", args: [expect.any(String)] }]);
    expect(callTokens).toEqual([{ windowLabel: "B", documentId: "d1", generation: g }]);
    const lines = uiMenuLines().filter((l) => l.payload.event === "ui.menu.select");
    expect(lines.map((l) => [l.payload.status, l.payload.context.windowLabel])).toEqual([["success", "B"]]);
    a.unmount();
    b.unmount();
  });
});

describe("a wrong or missing target fails closed (S4: every row × every bad target)", () => {
  const BAD_TARGETS: unknown[] = ["B", "", undefined, null, "a", "A ", " A"];

  it.each(collectionCases("tests/d261-menu-target-routing.test.ts:97", ROWS.map((row) => [`${row.n}: ${row.action}`, row] as const)))("%s", async (_label, row) => {
    const h = await mountAs("A", 1);
    for (const target of BAD_TARGETS) {
      const before = uiMenuLines().length;
      bus.emitAny(EVT, { ...payloadOf(row), target });
      await flush();

      const added = uiMenuLines().slice(before);
      expect(calls, `target ${JSON.stringify(target)}`).toEqual([]);
      expect(added.map((l) => l.payload), `target ${JSON.stringify(target)}`).toEqual([wrongTargetLine("A")]);
    }
    h.unmount();
  });

  it("a payload Rust sent to this window without a target, or with an empty one, is dropped", async () => {
    const h = await mountAs("A", 1);
    bus.emitTo("A", EVT, { action: "file.close" });
    bus.emitTo("A", EVT, { action: "file.close", target: "" });
    await flush();

    expect(calls).toEqual([]);
    expect(menuLogs("ui.menu.select").map((l) => l.payload)).toEqual([wrongTargetLine("A"), wrongTargetLine("A")]);
    h.unmount();
  });

  it("positive control: the same mount acts on its own target", async () => {
    const h = await mountAs("A", 1);
    bus.emitAny(EVT, { action: "file.close", target: "A" });
    await flush();
    expect(calls).toEqual([{ gen: 1, key: "onClose", args: [expect.any(String)] }]);
    expect(menuLogs("ui.menu.select").map((l) => l.payload.status)).toEqual(["success"]);
    h.unmount();
  });
});

describe("the label is read once at mount, not per event (S3)", () => {
  it("after the mock label changes, A still acts on target A and refuses target B as A", async () => {
    const h = await mountAs("A", 1);
    win.label = "B";

    bus.emitTo("A", EVT, { action: "file.close", target: "A" });
    await flush();
    expect(calls).toEqual([{ gen: 1, key: "onClose", args: [expect.any(String)] }]);
    expect(callTokens).toMatchObject([{ windowLabel: "A" }]);

    bus.emitAny(EVT, { action: "file.close", target: "B" });
    await flush();
    expect(calls).toHaveLength(1);
    const cancels = menuLogs("ui.menu.select").filter((l) => l.payload.status === "cancel");
    expect(cancels.map((l) => l.payload.context)).toEqual([{ windowLabel: "A", reason: "wrong_target" }]);
    h.unmount();
  });
});

describe("the token is captured at receipt, not at mount (S5)", () => {
  it("one mount, two switches between two clicks: each token reads the state at its own click", async () => {
    const g0 = getEditorGeneration();
    const h = await mountAs("A", 1);

    useDocumentStore.getState().setActiveDocument("d2");
    bus.emitTo("A", EVT, { action: "file.save", target: "A" });
    await flush();
    useEditorStore.getState().setEditorView(newView());
    bus.emitTo("A", EVT, { action: "file.save", target: "A" });
    await flush();

    expect(calls.map((c) => c.key)).toEqual(["onSave", "onSave"]);
    expect(callTokens).toEqual([
      { windowLabel: "A", documentId: "d2", generation: g0 + 1 },
      { windowLabel: "A", documentId: "d2", generation: g0 + 2 },
    ]);
    expect(callTokens[0]).not.toEqual(callTokens[1]);
    h.unmount();
  });

  type Step = GenEvent | "emit";
  const ALPHABET: readonly Step[] = ["switch-other", "view-new", "getter-new", "content", "emit"];

  it("seeds 1-50: the k-th token equals the shadow model at the k-th click", async () => {
    for (let seed = 1; seed <= 50; seed++) {
      resetMenuHarness();
      shadow = seedStores();
      const g0 = getEditorGeneration();
      const h = await mountAs("A", 1);
      const seq = genSequence(mulberry32(seed), ALPHABET, 15);
      let bumps = 0;
      const expected: unknown[] = [];
      for (const step of seq) {
        if (step === "emit") {
          expected.push({ windowLabel: "A", documentId: shadow.active, generation: g0 + bumps });
          bus.emitTo("A", EVT, { action: "file.save", target: "A" });
        } else {
          bumps += applyGenEvent(step, shadow);
        }
      }
      await flush();
      expect(callTokens, `seed ${seed}: ${JSON.stringify(seq)}`).toEqual(expected);
      expect(calls.length, `seed ${seed}`).toBe(expected.length);
      h.unmount();
    }
  });
});

describe("focus changing after the click has no effect (S3)", () => {
  it("a switch in the same tick as A's click: A acts once on its receipt-time document, B does not act", async () => {
    expect("isFocused" in getCurrentWindow(), "precondition: no focus query exists to call").toBe(false);
    const a = await mountAs("A", 1);
    const b = await mountAs("B", 2);

    bus.emitTo("A", EVT, { action: "file.save", target: "A" });
    useDocumentStore.getState().setActiveDocument("d2");
    await flush();

    expect(calls).toEqual([{ gen: 1, key: "onSave", args: [expect.any(String)] }]);
    expect(callTokens).toMatchObject([{ windowLabel: "A", documentId: "d1" }]);
    a.unmount();
    b.unmount();
  });
});

describe("the receipt-time token reaches every handler (S4: every row)", () => {
  it.each(collectionCases("tests/d261-menu-target-routing.test.ts:218", ROWS.map((row) => [`${row.n}: ${row.action}`, row] as const)))("%s", async (_label, row) => {
    const g = getEditorGeneration();
    const h = await mountAs("A", 1);
    bus.emitTo("A", EVT, { ...payloadOf(row), target: "A" });
    await flush();

    expect(calls).toEqual([{ gen: 1, key: row.key, args: [...row.args, expect.any(String)] }]);
    expect(callTokens).toEqual([{ windowLabel: "A", documentId: "d1", generation: g }]);
    const select = menuLogs("ui.menu.select");
    expect(select).toHaveLength(1);
    expect(select[0].payload.actionId).toBe(calls[0].args[calls[0].args.length - 1]);
    h.unmount();
  });
});

describe("D31 kept on the window-scoped listener (S5)", () => {
  it("an event delivered after cleanup, before the late unlisten runs, dispatches nothing", async () => {
    bus.state.autoResolve = false;
    win.label = "A";
    const h = mountHook(makeHandlers(1));
    await flush();
    h.unmount();
    bus.drain();
    // Registered by the late resolve, not yet unlistened: the cleanup flag must hold.
    expect(bus.count(EVT), "precondition: registered after cleanup").toBe(1);
    bus.emitTo("A", EVT, { action: "file.save", target: "A" });
    await flush();

    expect(calls).toEqual([]);
    expect(menuLogs("ui.menu.select")).toHaveLength(0);
    expect(bus.count(EVT)).toBe(0);
  });

  it("subscribes through the window, never through the global event listen", async () => {
    const h = await mountAs("A", 1);
    expect(bus.count(EVT)).toBe(1);
    // A global (Any) listener would hear B's targeted emit; a window listener does not.
    bus.emitTo("B", EVT, { action: "file.save", target: "B" });
    await flush();
    expect(uiMenuLines().filter((l) => l.payload.event === "ui.menu.select")).toHaveLength(0);
    h.unmount();
    await flush();
    expect(bus.count(EVT)).toBe(0);
  });
});
