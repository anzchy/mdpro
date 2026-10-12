/**
 * D172 — an external modified/deleted event must not re-render App in a loop while
 * the reload prompt is up, and withdrawing one document's prompt must not clear
 * another document's pending event.
 *
 * Since D165, App's file-change decision effect listed `clearEvent` in its deps.
 * `useFileWatcher` returned a new `clearEvent` every render, and `raiseReload` set a
 * new prompt object every call, so each render re-ran the effect, which re-set the
 * prompt, which rendered again: a pegged renderer.
 *
 * The harness composes the three real pieces exactly as App.tsx wires them: the real
 * `useFileWatcher`, the real `useReloadPrompt` (called before the decision effect,
 * as in App) and a copy of App's decision effect with the same deps and the real
 * `decideFileChange`. The render counter throws past a hard cap so a loop fails the
 * test fast instead of hanging it.
 *
 * Mock boundary: `@tauri-apps/api/{event,core,window}` via fileWatcherLogHarness.
 */
import { useEffect } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./helpers/fileWatcherLogHarness")).coreModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);

import { bus, makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import { useFileWatcher, type FileChangedEvent } from "../src/hooks/useFileWatcher";
import { useReloadPrompt } from "../src/hooks/useReloadPrompt";
import { decideFileChange } from "../src/utils/dataLossGuards";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const DEBOUNCE_MS = 300;
/** Past this the harness throws: a loop, not a settle. */
const RENDER_CAP = 200;
/** Renders an event may cost once it is delivered: event, prompt, slack. */
const SETTLE_BUDGET = 5;
const MODIFIED_MSG = "File was modified externally. Reload to update content?";
const DELETED_MSG = "File was deleted externally. Save to a new location if needed.";

const A = makeDoc({ id: "a", path: "/tmp/a.md" });
const B = makeDoc({ id: "b", path: "/tmp/b.md" });

let renders = 0;
let latest: {
  event: FileChangedEvent | null;
  clearEvent: unknown;
  reloadMessage: string | null;
  raiseReload: (message: string, documentId: string, path: string) => void;
} | null = null;

/** App.tsx's file-watcher / reload-prompt wiring, nothing else. */
function Harness() {
  renders += 1;
  if (renders > RENDER_CAP) throw new Error(`render loop: more than ${RENDER_CAP} renders`);
  const activeDocument = useDocumentStore((s) => s.documents.find((d) => d.id === s.activeDocumentId));
  const updateDocumentPath = useDocumentStore((s) => s.updateDocumentPath);
  const { event: fileChangeEvent, clearEvent } = useFileWatcher(activeDocument?.path ?? null);
  const { reloadMessage, raiseReload } = useReloadPrompt(clearEvent);

  useEffect(() => {
    if (!activeDocument || !fileChangeEvent) return;
    const decision = decideFileChange(fileChangeEvent, activeDocument);
    switch (decision.action) {
      case "ignore":
        return;
      case "rename":
        updateDocumentPath(activeDocument.id, decision.newPath);
        clearEvent();
        return;
      case "deleted-prompt":
        raiseReload(decision.message, activeDocument.id, fileChangeEvent.path);
        return;
      case "reload-prompt":
        raiseReload(decision.message, activeDocument.id, fileChangeEvent.path);
        return;
    }
  }, [activeDocument, clearEvent, fileChangeEvent, raiseReload, updateDocumentPath]);

  latest = { event: fileChangeEvent, clearEvent, reloadMessage, raiseReload };
  return null;
}

async function mount() {
  const view = render(<Harness />);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

function change(path: string, changeType: FileChangedEvent["changeType"]): FileChangedEvent {
  return { path, changeType, timestamp: 1_700_000_000_000 };
}

let consoleError: ReturnType<typeof vi.spyOn>;
const maxDepthErrors = () =>
  consoleError.mock.calls.filter((args) => String(args[0]).includes("Maximum update depth"));

beforeEach(() => {
  resetHarness();
  renders = 0;
  latest = null;
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [A, B], activeDocumentId: "a" });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D172 — the reload prompt settles instead of looping", () => {
  it.each([
    ["modified", MODIFIED_MSG],
    ["deleted", DELETED_MSG],
  ] as const)("a %s event raises the prompt within a bounded number of renders", async (kind, message) => {
    await mount();
    act(() => bus.emit("file:changed", change(A.path!, kind)));
    const before = renders;

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(latest?.reloadMessage).toBe(message);
    expect(renders - before).toBeLessThanOrEqual(SETTLE_BUDGET);
    expect(maxDepthErrors()).toEqual([]);

    // Nothing else is queued: another tick costs no render.
    const settled = renders;
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(renders).toBe(settled);
  });
});

describe("D172 — withdrawing A's prompt leaves B's pending event alone", () => {
  it("A closes in the same commit as B's event: B's event stays pending and B's prompt is up", async () => {
    await mount();
    act(() => bus.emit("file:changed", change(A.path!, "modified")));
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(latest?.reloadMessage).toBe(MODIFIED_MSG);

    // Switch to B; A's prompt stays (it is bound to A, not to the active doc).
    await act(async () => {
      useDocumentStore.setState({ activeDocumentId: "b" });
      await Promise.resolve();
    });
    act(() => bus.emit("file:changed", change(B.path!, "deleted")));

    // B's debounce fires and A closes in one act → one React commit.
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
      useDocumentStore.getState().closeDocument("a");
    });

    expect(latest?.event?.path).toBe(B.path);
    expect(latest?.reloadMessage).toBe(DELETED_MSG);
    expect(maxDepthErrors()).toEqual([]);
  });

  it("A closes while its own event is pending: that event is cleared", async () => {
    await mount();
    act(() => bus.emit("file:changed", change(A.path!, "modified")));
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(latest?.event?.path).toBe(A.path);

    act(() => {
      useDocumentStore.getState().closeDocument("a");
    });

    expect(latest?.event).toBeNull();
  });
});

describe("D172 — unit: stable identities and idempotent raise", () => {
  it("clearEvent keeps its identity across renders", async () => {
    await mount();
    const first = latest?.clearEvent;
    act(() => bus.emit("file:changed", change(A.path!, "modified")));
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(renders).toBeGreaterThan(1);
    expect(latest?.clearEvent).toBe(first);
  });

  it("raiseReload with the same arguments does not re-render", async () => {
    await mount();
    act(() => latest?.raiseReload("m", "a", A.path!));
    // React may render once more to learn an updater returned the same state (its
    // eager bail-out needs both fibers idle); it commits nothing. From then on a
    // repeat raise must cost no render at all — the old code re-rendered every time.
    act(() => latest?.raiseReload("m", "a", A.path!));
    const before = renders;
    act(() => latest?.raiseReload("m", "a", A.path!));
    expect(renders).toBe(before);
  });

  it("raiseReload with a different message or document replaces the prompt", async () => {
    await mount();
    act(() => latest?.raiseReload("m1", "a", A.path!));
    expect(latest?.reloadMessage).toBe("m1");
    act(() => latest?.raiseReload("m2", "a", A.path!));
    expect(latest?.reloadMessage).toBe("m2");
    act(() => latest?.raiseReload("m3", "b", B.path!));
    expect(latest?.reloadMessage).toBe("m3");
  });
});
