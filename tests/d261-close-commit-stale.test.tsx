/**
 * D261 H1 (audit round 1, PR #503): a close commits to the store only for the
 * document lifetime it started on.
 *
 * Both close paths in `useDocument` (`closeActiveDocument`, reached by the
 * close prompt's Discard through `confirmDocumentClose`, and `closeDocumentById`,
 * the tab-bar X) await `close_document` and then remove the document by id. A
 * reopened file comes back under the same path-derived id, so a reply held
 * across close → reopen → typing used to remove the reopened document with its
 * unsaved text.
 *
 * Law: when the reply lands, the store removes `id` iff `id`'s D214 baseline
 * epoch has not moved since the IPC was sent; otherwise it removes nothing and
 * logs `file.close` cancel `{reason:"stale", stage:"close_commit"}`.
 *
 * Mocked: `@tauri-apps/api/{core,window,event}`; `close_document` replies are
 * held until the test releases them, `log_event` is captured. Everything else
 * is the real stores (after Fable's round-1 repro).
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { win, held, ipc, logs } = vi.hoisted(() => ({
  win: { label: "A" },
  held: [] as Array<() => void>,
  ipc: [] as string[],
  logs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: win.label }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "log_event") {
      logs.push((args.payload as Record<string, unknown>) ?? {});
      return null;
    }
    if (cmd === "close_document") {
      ipc.push(`close_document:${String(args.documentId)}`);
      await new Promise<void>((resolve) => held.push(resolve));
      return { success: true };
    }
    return null;
  },
}));

import { useDocument } from "../src/hooks/useDocument";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { captureToken, confirmDocumentClose } from "../src/utils/menuTargetToken";
import { doc } from "./support/editorGenerationDomain";

const TYPED = "reopened + unsaved typing";

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
const openIds = () => useDocumentStore.getState().documents.map((d) => d.id);
const staleCommitLines = () =>
  logs.filter(
    (l) =>
      l.event === "file.close" &&
      l.status === "cancel" &&
      (l.context as { reason?: string; stage?: string } | undefined)?.reason === "stale" &&
      (l.context as { stage?: string }).stage === "close_commit",
  );

beforeEach(() => {
  win.label = "A";
  held.length = 0;
  ipc.length = 0;
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
  useMilkdownEditorStore.setState({ flushers: {} });
  useMilkdownEditorStore.getState().unregisterEditor();
  useEditorStore.getState().setEditorView(null);
  useDocumentStore.setState({
    documents: [{ ...doc("d1", "dirty"), isModified: true }, doc("d2", "clean")],
    activeDocumentId: "d1",
  });
});

type Hook = ReturnType<typeof useDocument>;

/** While the first reply is held: tab X closes d1 to completion, then the same path reopens and is typed into. */
async function closeElsewhereReopenAndType(hook: () => Hook): Promise<void> {
  let other!: Promise<unknown>;
  act(() => {
    other = hook().closeDocumentById("d1", true);
  });
  await flush();
  expect(held).toHaveLength(2);
  held[1]();
  await act(async () => {
    await other;
  });
  expect(openIds()).toEqual(["d2"]);
  act(() => {
    useDocumentStore.getState().upsertDocument({ ...doc("d1", "reopened") });
    useDocumentStore.getState().setActiveDocument("d1");
    useDocumentStore.getState().updateDocumentContent("d1", TYPED);
  });
  expect(useDocumentStore.getState().getDocumentById("d1")?.isModified).toBe(true);
}

describe("D261 H1: a held close reply never removes a reopened same-id document", () => {
  it("close-prompt Discard: the reopened d1 keeps its unsaved text and the stale commit is logged", async () => {
    const { result } = renderHook(() => useDocument());
    const stored = captureToken("A");
    let first!: Promise<boolean>;
    act(() => {
      first = confirmDocumentClose(stored, result.current.closeActiveDocument);
    });
    await flush();
    expect(ipc).toEqual(["close_document:d1"]);
    const releaseFirst = held[0];

    await closeElsewhereReopenAndType(() => result.current);

    releaseFirst();
    await act(async () => {
      await first;
    });
    expect(openIds()).toEqual(["d2", "d1"]);
    expect(useDocumentStore.getState().getDocumentById("d1")?.content).toBe(TYPED);
    expect(useDocumentStore.getState().activeDocumentId).toBe("d1");
    expect(staleCommitLines()).toHaveLength(1);
    expect((staleCommitLines()[0].context as { documentId?: string }).documentId).toBe("d1");
  });

  it("tab X: the reopened d1 keeps its unsaved text and the stale commit is logged", async () => {
    const { result } = renderHook(() => useDocument());
    let first!: Promise<unknown>;
    act(() => {
      first = result.current.closeDocumentById("d1", true);
    });
    await flush();
    expect(ipc).toEqual(["close_document:d1"]);
    const releaseFirst = held[0];

    await closeElsewhereReopenAndType(() => result.current);

    releaseFirst();
    await act(async () => {
      await first;
    });
    expect(openIds()).toEqual(["d2", "d1"]);
    expect(useDocumentStore.getState().getDocumentById("d1")?.content).toBe(TYPED);
    expect(staleCommitLines()).toHaveLength(1);
  });
});

describe("D261 H1 controls: an undisturbed close still removes its document", () => {
  it("close-prompt Discard with no interleaving removes d1, moves to d2, logs no stale commit", async () => {
    const { result } = renderHook(() => useDocument());
    let first!: Promise<boolean>;
    act(() => {
      first = confirmDocumentClose(captureToken("A"), result.current.closeActiveDocument);
    });
    await flush();
    held[0]();
    let closed: boolean | undefined;
    await act(async () => {
      closed = await first;
    });
    expect(closed).toBe(true);
    expect(openIds()).toEqual(["d2"]);
    expect(useDocumentStore.getState().activeDocumentId).toBe("d2");
    expect(useEditorStore.getState().activeDocumentId).toBe("d2");
    expect(staleCommitLines()).toHaveLength(0);
  });

  it("tab X while typing continues in d1 (same lifetime) still removes d1", async () => {
    const { result } = renderHook(() => useDocument());
    let first!: Promise<unknown>;
    act(() => {
      first = result.current.closeDocumentById("d1", true);
    });
    await flush();
    act(() => {
      useDocumentStore.getState().updateDocumentContent("d1", "dirty + more");
      useDocumentStore.getState().setActiveDocument("d2");
    });
    held[0]();
    await act(async () => {
      await first;
    });
    expect(openIds()).toEqual(["d2"]);
    expect(staleCommitLines()).toHaveLength(0);
  });
});
