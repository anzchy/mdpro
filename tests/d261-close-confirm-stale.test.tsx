/**
 * D261-WI-1d: `confirmDocumentClose(storedToken, closeActiveDocument)` in
 * `src/utils/menuTargetToken.ts`, the document branch of App's
 * `handleConfirmClose`.
 *
 * Law: confirming a document-close prompt closes exactly the prompted document
 * iff the token stored when the prompt opened is still current, and otherwise
 * closes nothing. A token captured at confirm time is never the one checked:
 * at the moment of every confirm below a fresh capture WOULD be current, so a
 * helper that re-captures passes nothing here. A null stored token fails closed.
 *
 * Rendering `App` in jsdom is impractical (see `d253-last-tab-window-close.test.tsx`),
 * so the helper runs against the real `useDocument().closeActiveDocument`
 * (through `renderHook`) and the real `decideCloseRequest`; App's wiring of the
 * stored token is pinned in `d261-app-wiring.test.ts`.
 *
 * Mocked: `@tauri-apps/api/{core,window}`; `invoke` records `close_document`
 * and answers success, and captures `log_event`.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { win, logs, ipc } = vi.hoisted(() => ({
  win: { label: "A" },
  logs: [] as Array<Record<string, unknown>>,
  ipc: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: win.label }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "log_event") {
      logs.push((args.payload as Record<string, unknown>) ?? {});
      return null;
    }
    ipc.push({ cmd, args });
    if (cmd === "close_document") return { success: true };
    return null;
  },
}));

import { useDocument } from "../src/hooks/useDocument";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { activeDocumentAfterFlush, decideCloseRequest } from "../src/utils/dataLossGuards";
import { captureToken, confirmDocumentClose, type MenuTargetToken } from "../src/utils/menuTargetToken";
import { doc, newView } from "./support/editorGenerationDomain";

type Cause = "SWITCH" | "AWAY_BACK" | "REMOUNT";

const staleLines = () =>
  logs.filter((l) => l.event === "ui.menu.select" && (l.context as { reason?: string })?.reason === "stale");
const closeCalls = () => ipc.filter((c) => c.cmd === "close_document");
const openIds = () => useDocumentStore.getState().documents.map((d) => d.id);

beforeEach(() => {
  win.label = "A";
  logs.length = 0;
  ipc.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
  useMilkdownEditorStore.setState({ flushers: {} });
  useMilkdownEditorStore.getState().unregisterEditor();
  useEditorStore.getState().setEditorView(null);
  useDocumentStore.setState({
    documents: [{ ...doc("d1", "dirty"), isModified: true }, doc("d2", "clean")],
    activeDocumentId: "d1",
  });
});

/** ⌘W on dirty d1: the prompt opens, and App stores the token at that moment. */
function promptOnD1(): MenuTargetToken {
  expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("prompt");
  return captureToken("A");
}

function applyCause(cause: Cause): void {
  act(() => {
    if (cause === "SWITCH") {
      useDocumentStore.getState().setActiveDocument("d2");
    } else if (cause === "AWAY_BACK") {
      useDocumentStore.getState().setActiveDocument("d2");
      useDocumentStore.getState().setActiveDocument("d1");
    } else {
      useEditorStore.getState().setEditorView(newView());
    }
  });
}

describe("a stale confirm closes nothing (S4 over the three causes)", () => {
  it.each<Cause>(["SWITCH", "AWAY_BACK", "REMOUNT"])("%s", async (cause) => {
    const { result } = renderHook(() => useDocument());
    const stored = promptOnD1();
    applyCause(cause);
    logs.length = 0;

    let closed: boolean | undefined;
    await act(async () => {
      closed = await confirmDocumentClose(stored, result.current.closeActiveDocument);
    });

    expect(closed).toBe(false);
    expect(openIds()).toEqual(["d1", "d2"]);
    expect(closeCalls()).toHaveLength(0);
    const stale = staleLines();
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ event: "ui.menu.select", status: "cancel" });
    expect(stale[0].context).toMatchObject({ windowLabel: "A", reason: "stale", stage: "close_confirm" });
  });
});

describe("a current confirm closes the prompted document (S2)", () => {
  it("returns true, closes d1 only, logs no stale line", async () => {
    const { result } = renderHook(() => useDocument());
    const stored = promptOnD1();

    let closed: boolean | undefined;
    await act(async () => {
      closed = await confirmDocumentClose(stored, result.current.closeActiveDocument);
    });

    expect(closed).toBe(true);
    expect(openIds()).toEqual(["d2"]);
    expect(closeCalls().map((c) => c.args.documentId)).toEqual(["d1"]);
    expect(staleLines()).toHaveLength(0);
  });

  it("typing between the prompt and the confirm does not stale it", async () => {
    const { result } = renderHook(() => useDocument());
    const stored = promptOnD1();
    act(() => useDocumentStore.getState().updateDocumentContent("d1", "dirtier"));

    let closed: boolean | undefined;
    await act(async () => {
      closed = await confirmDocumentClose(stored, result.current.closeActiveDocument);
    });
    expect(closed).toBe(true);
    expect(openIds()).toEqual(["d2"]);
  });
});

describe("a null stored token fails closed (S3)", () => {
  it("returns false, closes nothing, logs one stale close_confirm line", async () => {
    const { result } = renderHook(() => useDocument());
    promptOnD1();

    let closed: boolean | undefined;
    await act(async () => {
      closed = await confirmDocumentClose(null, result.current.closeActiveDocument);
    });

    expect(closed).toBe(false);
    expect(openIds()).toEqual(["d1", "d2"]);
    expect(closeCalls()).toHaveLength(0);
    const stale = staleLines();
    expect(stale).toHaveLength(1);
    expect(stale[0].context).toMatchObject({ windowLabel: "A", reason: "stale", stage: "close_confirm" });
  });
});
