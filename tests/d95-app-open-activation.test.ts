/**
 * D95 ② / D125 — App's open follow-ups run only for an open whose document became
 * active, and the drop's outcome log says so in the shared field names.
 *
 * A D92-refused open still writes its tab (inactive). Before D95, App applied the
 * default view mode after any open that returned a document, so with a Source default
 * and a flush that still fails one drop or Finder open was refused twice (two toasts),
 * and `file.open.drop` said `success` with no sign of the refusal.
 *
 * Decided behaviour:
 * - `handleOpenPath` and `openPaths` open through `useDocument().openPathOutcome`,
 *   which resolves to `{ document, activated }`.
 * - The recent-files update still happens for every open that opened (the file did
 *   open); only the view-mode follow-up waits for `activated`.
 * - `file.open.drop` keeps `success` / `fail` meaning "the open happened" (as the
 *   guard's own logs do, ADR-0071 decision 3) and carries `context.activated`; a
 *   refused activation adds `reason: "flush-failed"` (D125, the same shape as the
 *   open-in-window route).
 *
 * ── SPEC LEVEL: BEHAVIOUR ───────────────────────────────────────────────────
 * D125 moved these callbacks out of App.tsx into `useOpenPaths`, so they run here
 * against the real `useDocument`, open-write guard and stores. Before D125 this file
 * matched App.tsx's source text, because App cannot be rendered in jsdom.
 *
 * Mock boundary: `@tauri-apps/api/{core,event,window}` (`open_file` answers per path)
 * and the `loggingService` sink. Flusher doubles go through the public
 * `registerFlusher` seam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { invokeMock, sink } = vi.hoisted(() => {
  let n = 0;
  return {
    invokeMock: vi.fn(),
    sink: {
      generateActionId: vi.fn(() => `gen-${++n}`),
      logEvent: vi.fn(async () => {}),
      logEventSync: vi.fn(),
      logUiEvent: vi.fn(() => "ui-id"),
      logDialogAction: vi.fn(),
    },
  };
});

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));

import { useDocument } from "../src/hooks/useDocument";
import { useOpenPaths } from "../src/hooks/useOpenPaths";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";

const TAB_TOAST = "Editor changes could not be captured; stayed on this document";
const OPEN_FAILED = "Failed to open file";

function doc(id: string, path: string): Document {
  return { id, path, content: `c-${id}`, encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null };
}

type LogPayload = {
  level?: string;
  event: string;
  status: string;
  actionId?: string;
  error?: string;
  context?: Record<string, unknown>;
};
const logs = (event: string): LogPayload[] =>
  sink.logEventSync.mock.calls.map(([p]) => p as LogPayload).filter((p) => p.event === event);
const dropOutcomes = () => logs("file.open.drop").filter((p) => p.status !== "start");
const activeIds = () => [useDocumentStore.getState().activeDocumentId, useEditorStore.getState().activeDocumentId];

let cleanups: Array<() => void> = [];
function installFlusher(documentId: string, status: "failed" | "clean"): void {
  cleanups.push(useMilkdownEditorStore.getState().registerFlusher(documentId, () => ({ status })));
}

let toasts: string[] = [];
const realShowToast = useToastStore.getState().showToast;

/** `open_file` decodes each listed document by its path; any other path is too large. */
function answerOpens(...decoded: Document[]): void {
  invokeMock.mockImplementation(async (cmd: string, args?: { path?: string }) => {
    if (cmd !== "open_file") return null;
    const hit = decoded.find((d) => d.path === args?.path);
    if (!hit) throw { FileTooLarge: { path: args?.path, size: 10485761 } };
    return { document: hit, recoveredDraft: null };
  });
}

const recent = vi.fn<(path: string) => void>();
const busy = vi.fn<(label: string | null) => void>();
const viewModes: string[] = [];

function mount() {
  return renderHook(() => {
    const { openPathOutcome } = useDocument();
    return useOpenPaths({
      openPathOutcome,
      updateRecentFiles: recent,
      setBusyLabel: busy,
      defaultViewMode: "source",
      setViewMode: (mode) => {
        viewModes.push(mode);
        return useEditorStore.getState().setViewMode(mode);
      },
    });
  }).result;
}

beforeEach(() => {
  toasts = [];
  viewModes.length = 0;
  recent.mockReset();
  busy.mockReset();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
  sink.logEventSync.mockClear();
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useToastStore.getState().clearToast();
  useToastStore.setState({
    showToast: (message: string, durationMs?: number) => {
      toasts.push(message);
      realShowToast(message, durationMs);
    },
  });
  useDocumentStore.setState({ documents: [doc("doc-a", "/tmp/a.md")], activeDocumentId: "doc-a" });
  useEditorStore.setState({
    activeDocumentId: "doc-a",
    viewMode: "wysiwyg",
    userViewModeChoice: { seq: 0, mode: "wysiwyg" },
  });
});

afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  useToastStore.getState().clearToast();
  useToastStore.setState({ showToast: realShowToast });
});

describe("D95 ② handleOpenPath", () => {
  it("resolves to the outcome and records the recent file even when activation was refused", async () => {
    installFlusher("doc-a", "failed");
    answerOpens(doc("doc-n", "/tmp/n.md"));
    const api = mount();
    let opened: unknown = "unset";
    await act(async () => {
      opened = await api.current.handleOpenPath("/tmp/n.md", "recent-1");
    });
    expect(opened).toMatchObject({ document: { id: "doc-n" }, activated: false });
    expect(recent.mock.calls).toEqual([["/tmp/n.md"]]);
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    expect(busy.mock.calls).toEqual([["Opening file..."], [null]]);
    // The caller's actionId reaches the read.
    expect(invokeMock).toHaveBeenCalledWith("open_file", expect.objectContaining({ actionId: "recent-1" }));
  });

  it("a failed open records nothing, adds no toast of its own, and clears the busy label", async () => {
    answerOpens();
    const api = mount();
    let opened: unknown = "unset";
    await act(async () => {
      opened = await api.current.handleOpenPath("/tmp/big.md");
    });
    expect(opened).toBeNull();
    expect(recent).not.toHaveBeenCalled();
    expect(toasts).toEqual([OPEN_FAILED]);
    expect(busy.mock.calls).toEqual([["Opening file..."], [null]]);
  });
});

describe("D95 ② openPaths", () => {
  it("records every opened file but calls onOpened only for an activated one", async () => {
    installFlusher("doc-a", "failed");
    answerOpens(doc("doc-n", "/tmp/n.md"));
    const api = mount();
    const onOpened = vi.fn();
    await act(async () => {
      await api.current.openPaths(["/tmp/n.md", "/tmp/big.md"], onOpened);
    });
    expect(recent.mock.calls).toEqual([["/tmp/n.md"]]);
    expect(onOpened).not.toHaveBeenCalled();
    expect(toasts).toEqual([TAB_TOAST, OPEN_FAILED]);
  });

  it("control: a clean flush activates, so onOpened runs once per activated open", async () => {
    installFlusher("doc-a", "clean");
    answerOpens(doc("doc-n", "/tmp/n.md"), doc("doc-m", "/tmp/m.md"));
    const api = mount();
    const onOpened = vi.fn();
    await act(async () => {
      await api.current.openPaths(["/tmp/n.md", "/tmp/big.md", "/tmp/m.md"], onOpened);
    });
    expect(onOpened).toHaveBeenCalledTimes(2);
    expect(recent.mock.calls).toEqual([["/tmp/n.md"], ["/tmp/m.md"]]);
    expect(activeIds()).toEqual(["doc-m", "doc-m"]);
  });
});

describe("D95 ② / D125 openDroppedMarkdown", () => {
  it("a refused drop leaves the view mode alone and logs success, activated false, reason flush-failed", async () => {
    installFlusher("doc-a", "failed");
    answerOpens(doc("doc-n", "/tmp/n.md"));
    const api = mount();
    await act(async () => {
      await api.current.openDroppedMarkdown(["/tmp/n.md"]);
    });
    expect(viewModes).toEqual([]);
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
    expect(toasts).toEqual([TAB_TOAST]);
    const [start] = logs("file.open.drop");
    expect(dropOutcomes()).toEqual([
      {
        level: "info",
        event: "file.open.drop",
        status: "success",
        actionId: start.actionId,
        context: { filePath: "/tmp/n.md", openedInNewWindow: false, activated: false, reason: "flush-failed" },
        error: undefined,
      },
    ]);
  });

  it("an activated drop applies the default view mode once and logs success, activated true, no reason", async () => {
    installFlusher("doc-a", "clean");
    answerOpens(doc("doc-n", "/tmp/n.md"), doc("doc-m", "/tmp/m.md"));
    const api = mount();
    await act(async () => {
      await api.current.openDroppedMarkdown(["/tmp/n.md", "/tmp/m.md"]);
    });
    expect(viewModes).toEqual(["source"]);
    expect(dropOutcomes().map((p) => [p.status, p.context])).toEqual([
      ["success", { filePath: "/tmp/n.md", openedInNewWindow: false, activated: true }],
      ["success", { filePath: "/tmp/m.md", openedInNewWindow: false, activated: true }],
    ]);
  });

  it("a failed drop logs fail 'open failed', activated false and no reason, and keeps the view mode", async () => {
    answerOpens();
    const api = mount();
    await act(async () => {
      await api.current.openDroppedMarkdown(["/tmp/big.md"]);
    });
    expect(viewModes).toEqual([]);
    expect(dropOutcomes()).toHaveLength(1);
    expect(dropOutcomes()[0]).toMatchObject({ level: "error", status: "fail", error: "open failed" });
    expect(dropOutcomes()[0].context).toEqual({ filePath: "/tmp/big.md", openedInNewWindow: false, activated: false });
  });

  it("each dropped file's start, read and outcome share one actionId", async () => {
    installFlusher("doc-a", "clean");
    answerOpens(doc("doc-n", "/tmp/n.md"), doc("doc-m", "/tmp/m.md"));
    const api = mount();
    await act(async () => {
      await api.current.openDroppedMarkdown(["/tmp/n.md", "/tmp/m.md"]);
    });
    const ids = logs("file.open.drop").map((p) => p.actionId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
    const reads = invokeMock.mock.calls.filter(([cmd]) => cmd === "open_file").map(([, a]) => (a as { actionId?: string }).actionId);
    expect(reads).toEqual([ids[0], ids[2]]);
  });
});
