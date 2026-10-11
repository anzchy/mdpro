/**
 * D95 ② — an open says whether its document became active.
 *
 * D92 lets the open-write guard write a freshly opened document but withhold its
 * activation when the active document's WYSIWYG flush fails. `openDocumentFromPath`
 * still returned the document, so App's follow-ups (drop / Finder open: switch to the
 * default view mode) ran as if the open had activated it. With a Source default and a
 * flush that still fails, that switch was refused a second time: one open, two toasts.
 *
 * `useDocument().openPathOutcome` resolves to `{ document, activated }` (or `null` when
 * nothing opened). `activated` is false exactly when the guard refused the activation.
 * App gates the view-mode follow-up on it (wiring pinned by
 * `tests/d95-app-open-activation.test.ts`, App is never rendered in tests); this file
 * drives the real hook, guard and stores, with the same gate App applies.
 *
 * Mock boundary: `@tauri-apps/api/{core,event,window}` (`open_file` answers with the
 * decoded document) and the `loggingService` sink. Flusher doubles go through the public
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
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";
import { onFirstSuccess } from "../src/utils/onFirstSuccess";

const TAB_TOAST = "Editor changes could not be captured; stayed on this document";

function doc(id: string, path: string | null, isModified = false, content = `c-${id}`): Document {
  return { id, path, content, encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: null };
}

type LogPayload = { event: string; status: string; actionId?: string; context?: Record<string, unknown> };
const refusalLogs = (): LogPayload[] =>
  sink.logEventSync.mock.calls
    .map(([p]) => p as LogPayload)
    .filter((p) => p.context?.cause === "flush-failed");

const activeIds = () => [
  useDocumentStore.getState().activeDocumentId,
  useEditorStore.getState().activeDocumentId,
];
const docIds = () => useDocumentStore.getState().documents.map((d) => d.id);

let cleanups: Array<() => void> = [];
function installFlusher(documentId: string, status: "failed" | "clean"): void {
  cleanups.push(
    useMilkdownEditorStore.getState().registerFlusher(documentId, () => ({ status })),
  );
}

let toasts: string[] = [];
const realShowToast = useToastStore.getState().showToast;

/** `open_file` decodes `path` to `decoded`; any other path or command answers null. */
function answerOpen(decoded: Document): void {
  invokeMock.mockImplementation(async (cmd: string, args?: { path?: string }) =>
    cmd === "open_file" && args?.path === decoded.path ? { document: decoded } : null,
  );
}

/** Make `open_file` reject with the encoding error shape for `path`. */
function answerEncodingError(path: string): void {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "open_file") throw { EncodingError: { path, detected: "unknown" } };
    return null;
  });
}

type Api = ReturnType<typeof useDocument>;
function mount(): { current: Api } {
  return renderHook(() => useDocument()).result;
}

beforeEach(() => {
  toasts = [];
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

describe("D95 ② — openPathOutcome reports whether the opened document became active", () => {
  it("D95-2.1 a fresh open refused by a failed flush: written, activated false, one toast, the open's actionId", async () => {
    installFlusher("doc-a", "failed");
    const decoded = doc("doc-n", "/tmp/n.md");
    answerOpen(decoded);
    const api = mount();
    let outcome: Awaited<ReturnType<Api["openPathOutcome"]>> = null;
    await act(async () => {
      outcome = await api.current.openPathOutcome("/tmp/n.md", "drop-7");
    });
    expect(outcome).toEqual({ document: decoded, activated: false });
    expect(docIds()).toContain("doc-n");
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    expect(toasts).toEqual([TAB_TOAST]);
    const refusals = refusalLogs();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ event: "tab.switch", status: "fail", actionId: "drop-7" });
  });

  it("D95-2.2 control: a clean flush activates, activated true, no toast", async () => {
    installFlusher("doc-a", "clean");
    const decoded = doc("doc-n", "/tmp/n.md");
    answerOpen(decoded);
    const api = mount();
    let outcome: Awaited<ReturnType<Api["openPathOutcome"]>> = null;
    await act(async () => {
      outcome = await api.current.openPathOutcome("/tmp/n.md");
    });
    expect(outcome).toEqual({ document: decoded, activated: true });
    expect(activeIds()).toEqual(["doc-n", "doc-n"]);
    expect(toasts).toEqual([]);
  });

  it("D95-2.3 focusing an existing dirty tab is refused: the dirty tab comes back, activated false", async () => {
    const dirty = doc("doc-c", "/tmp/c.md", true, "C-BUF");
    useDocumentStore.setState({ documents: [doc("doc-a", "/tmp/a.md"), dirty] });
    installFlusher("doc-a", "failed");
    answerOpen(doc("doc-c", "/tmp/c.md", false, "DISK"));
    const api = mount();
    let outcome: Awaited<ReturnType<Api["openPathOutcome"]>> = null;
    await act(async () => {
      outcome = await api.current.openPathOutcome("/tmp/c.md");
    });
    expect(outcome).toEqual({ document: dirty, activated: false });
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    expect(toasts).toEqual([TAB_TOAST]);
  });

  it("D95-2.4 the decode-failure exit focusing a dirty tab is refused: activated false", async () => {
    const dirty = doc("doc-c", "/tmp/c.md", true, "C-BUF");
    useDocumentStore.setState({ documents: [doc("doc-a", "/tmp/a.md"), dirty] });
    installFlusher("doc-a", "failed");
    answerEncodingError("/tmp/c.md");
    const api = mount();
    let outcome: Awaited<ReturnType<Api["openPathOutcome"]>> = null;
    await act(async () => {
      outcome = await api.current.openPathOutcome("/tmp/c.md");
    });
    expect(outcome).toEqual({ document: dirty, activated: false });
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
  });

  it("D95-2.5 reopening the already-active document is activated (no switch to refuse)", async () => {
    useDocumentStore.setState({ documents: [doc("doc-a", "/tmp/a.md", true, "A-BUF")] });
    installFlusher("doc-a", "failed");
    answerOpen(doc("doc-a", "/tmp/a.md", false, "DISK"));
    const api = mount();
    let outcome: Awaited<ReturnType<Api["openPathOutcome"]>> = null;
    await act(async () => {
      outcome = await api.current.openPathOutcome("/tmp/a.md");
    });
    expect(outcome).toMatchObject({ activated: true });
    expect(toasts).toEqual([]);
  });

  it("D95-2.6 a failed open resolves to null", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "open_file") throw new Error("FileTooLarge");
      return null;
    });
    const api = mount();
    let outcome: Awaited<ReturnType<Api["openPathOutcome"]>> | "unset" = "unset";
    await act(async () => {
      outcome = await api.current.openPathOutcome("/tmp/big.md");
    });
    expect(outcome).toBeNull();
  });

  // D95-2.7 (the `openDocumentFromPath` wrapper's document-or-null contract) was removed
  // with the wrapper in D126: every by-path open now reads `openPathOutcome`.
});

describe("D95 ② — the view-mode follow-up runs only for an activated open", () => {
  /** App's drop / Finder-open follow-up: the default view mode, latched, gated on `activated`. */
  async function openLikeApp(api: { current: Api }, paths: string[]): Promise<void> {
    const applyDefaultViewMode = onFirstSuccess(() => useEditorStore.getState().setViewMode("source"));
    for (const path of paths) {
      const opened = await api.current.openPathOutcome(path);
      if (opened?.activated) applyDefaultViewMode();
    }
  }

  it("D95-2.8 one refused open with a Source default → exactly one toast, still WYSIWYG on doc-a", async () => {
    installFlusher("doc-a", "failed");
    answerOpen(doc("doc-n", "/tmp/n.md"));
    const api = mount();
    await act(async () => {
      await openLikeApp(api, ["/tmp/n.md"]);
    });
    expect(toasts).toEqual([TAB_TOAST]);
    expect(refusalLogs()).toHaveLength(1);
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
  });

  it("D95-2.9 control: an activated open applies the Source default", async () => {
    installFlusher("doc-a", "clean");
    answerOpen(doc("doc-n", "/tmp/n.md"));
    const api = mount();
    await act(async () => {
      await openLikeApp(api, ["/tmp/n.md"]);
    });
    expect(useEditorStore.getState().viewMode).toBe("source");
    expect(toasts).toEqual([]);
  });
});
