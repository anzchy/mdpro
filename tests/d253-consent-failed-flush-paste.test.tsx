/**
 * D253-WI-7 (audit b180, H3) — Discard consent over a failing flush must notice an
 * editor change that never reached the store.
 *
 * Law: when the WYSIWYG serializer cannot write (the flush fails), the store's
 * content cannot show that the editor moved on. A change made to the editor after
 * the prompt went up (an image paste resolving during Discard's state save) is not
 * covered by the consent: the latched Discard pass prompts again and the window
 * stays open. Regression guard: with no change after the prompt, Discard over the
 * same failing flush still closes the window once, so a document the serializer
 * cannot write never makes its window unclosable.
 *
 * Real: `MilkdownEditor`, the edit-sync plugin and controller, the serializer (its
 * failure is a real one: a list item with no content, as in D97), the stores,
 * `dataLossGuards`, the save body and the guard. The paste is a real
 * history-carrying transaction typed into the editor, so the test does not
 * depend on which accessor the fix uses to see it. Mocked boundaries:
 * `@tauri-apps/api/{window,core,event}` and the logging sink. The fake window
 * models Tauri v2 (`window.js` ~2028): `close()` emits CloseRequested and
 * destroys (`destroyCount`) unless prevented; `scaleFactor()`, the first await
 * of the state save, can be held by a gate. Paired real path: the D253 device
 * check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";

const { fake, gates, logEventSync } = vi.hoisted(() => {
  type CloseHandler = (event: { preventDefault: () => void }) => unknown;
  type Gate = { hold: boolean; waiting: number; release: () => void; wait: () => Promise<void> };
  const makeGate = (): Gate => {
    const resolvers: Array<() => void> = [];
    const gate: Gate = {
      hold: false,
      waiting: 0,
      release: () => {
        gate.hold = false;
        for (const r of resolvers.splice(0)) r();
        gate.waiting = 0;
      },
      wait: () => {
        if (!gate.hold) return Promise.resolve();
        gate.waiting += 1;
        return new Promise<void>((r) => resolvers.push(r));
      },
    };
    return gate;
  };
  const state = { handlers: new Set<CloseHandler>(), closeCalls: 0, destroyCount: 0 };
  const gates = { save: makeGate() };
  const win = {
    label: "doc-1",
    onCloseRequested(handler: CloseHandler): Promise<() => void> {
      state.handlers.add(handler);
      return Promise.resolve(() => {
        state.handlers.delete(handler);
      });
    },
    async close(): Promise<void> {
      state.closeCalls += 1;
      for (const handler of [...state.handlers]) {
        let prevented = false;
        await handler({ preventDefault: () => (prevented = true) });
        if (!prevented) state.destroyCount += 1;
      }
    },
    scaleFactor: async () => {
      await gates.save.wait();
      return 1;
    },
    innerSize: async () => ({ width: 1024, height: 768 }),
    outerPosition: async () => ({ x: 11, y: 22 }),
    isMaximized: async () => false,
    setTitle: async () => {},
  };
  return {
    fake: {
      state,
      win,
      reset() {
        state.handlers.clear();
        state.closeCalls = 0;
        state.destroyCount = 0;
        gates.save = makeGate();
      },
    },
    gates,
    logEventSync: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => fake.win }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync, logEvent: vi.fn(async () => {}), generateActionId: vi.fn(() => "test-id") },
}));

import type { Editor } from "@milkdown/kit/core";
import { serializerCtx } from "@milkdown/kit/core";
import type { Transaction } from "@milkdown/kit/prose/state";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { useWindowCloseGuard, type WindowCloseGuard } from "../src/hooks/useWindowCloseGuard";
import { useEditorStore } from "../src/stores/editorStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { docById, makeDoc, mountAndWait, resetStores, sleep, typeAtEnd, viewOf } from "./helpers/milkdownEditorHarness";

const LONG_CASE_MS = 60_000;
const PAST_EDIT_SYNC_DELAY_MS = 300;

type LogLine = { event?: string; status?: string; context?: Record<string, unknown> };
const actionLines = (action: string): LogLine[] =>
  logEventSync.mock.calls
    .map((c) => c[0] as LogLine)
    .filter((l) => l.event === "window.close_requested" && l.context?.action === action);

let guard: WindowCloseGuard | null = null;
function GuardProbe() {
  guard = useWindowCloseGuard();
  return null;
}

let unmountEditor: (() => void) | null = null;

async function mountEditorAndGuard(): Promise<Editor> {
  const { instance, unmount } = await mountAndWait(
    <>
      <MilkdownEditor />
      <GuardProbe />
    </>,
  );
  unmountEditor = unmount;
  await sleep(20); // the guard's onCloseRequested subscription settles
  return instance;
}

/** D97's shape: a paragraph and a bullet list whose only item is empty; the serializer throws. */
function breakingTr(instance: Editor): Transaction {
  const view = viewOf(instance);
  const s = view.state.schema;
  const para = s.nodes.paragraph.create(null, s.text("UNSERIALIZABLE"));
  const list = s.nodes.bullet_list.create(null, [s.nodes.list_item.create(null, [])]);
  return view.state.tr.insert(view.state.doc.content.size, [para, list]);
}

function serializerThrows(instance: Editor): boolean {
  const serialize = instance.action((ctx) => ctx.get(serializerCtx));
  try {
    serialize(viewOf(instance).state.doc);
    return false;
  } catch {
    return true;
  }
}

async function osClose() {
  await act(async () => {
    await fake.win.close();
  });
  await sleep(20);
}

/** A window whose only document is dirty with an edit the serializer cannot write. */
async function promptOverFailingFlush(): Promise<Editor> {
  const instance = await mountEditorAndGuard();
  await act(async () => {
    viewOf(instance).dispatch(breakingTr(instance)); // a user edit
  });
  await sleep(PAST_EDIT_SYNC_DELAY_MS); // the debounce write fails
  expect(serializerThrows(instance)).toBe(true);
  expect(docById("doc-a")!.isModified).toBe(true);
  expect(docById("doc-a")!.content).toBe("Hello world"); // the store never got it

  await osClose();
  expect(guard!.pendingClose).toBe("window");
  expect(fake.state.destroyCount).toBe(0);
  return instance;
}

beforeEach(() => {
  fake.reset();
  logEventSync.mockReset();
  guard = null;
  unmountEditor = null;
  installIntersectionObserverDouble();
  resetStores([makeDoc("doc-a", "Hello world", "/tmp/a.md")]);
  useEditorStore.setState({
    activeDocumentId: "doc-a",
    viewMode: "wysiwyg",
    userViewModeChoice: { seq: 0, mode: "wysiwyg" },
  });
});

afterEach(async () => {
  if (unmountEditor) {
    unmountEditor();
    await sleep(100);
  }
});

describe("Discard consent over a failing flush", () => {
  it(
    "an editor change during Discard's state save (a paste) prompts again, no close",
    async () => {
      const instance = await promptOverFailingFlush();

      gates.save.hold = true;
      let confirming: Promise<void> = Promise.resolve();
      await act(async () => {
        confirming = guard!.confirmClose();
      });
      await vi.waitFor(() => expect(gates.save.waiting).toBe(1));

      // The paste resolves: the editor changes, the store cannot.
      await act(async () => {
        typeAtEnd(instance, "PASTED");
      });
      expect(viewOf(instance).state.doc.textContent).toContain("PASTED");
      expect(docById("doc-a")!.content).toBe("Hello world");

      await act(async () => {
        gates.save.release();
        await confirming;
      });
      await sleep(50);

      expect(fake.state.destroyCount).toBe(0);
      expect(guard!.pendingClose).toBe("window");
      expect(actionLines("dirty_after_discard")).toHaveLength(1);
    },
    LONG_CASE_MS,
  );

  it(
    "regression: with no change after the prompt, Discard over the failing flush closes once",
    async () => {
      await promptOverFailingFlush();

      await act(async () => {
        await guard!.confirmClose();
      });
      await sleep(50);

      expect(fake.state.destroyCount).toBe(1);
      expect(guard!.pendingClose).toBeNull();
      expect(actionLines("dirty_after_discard")).toHaveLength(0);
    },
    LONG_CASE_MS,
  );
});
