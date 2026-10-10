/**
 * D121 ② — a pending encoding retry must not commit once it was cancelled.
 *
 * The encoding dialog's retry (`openDocumentWithEncoding`) awaits an `open_file`
 * re-read. If the user cancels the dialog (Cancel / Esc / backdrop) while that read
 * is in flight, or picks another encoding, the late result used to commit anyway.
 *
 * - CR-1 abort before the read resolves: no commit, the encoding issue is untouched,
 *   one `file.open.encoding_retry` cancel log, result `{ kind: "cancelled" }`.
 * - CR-2 abort before the read rejects: the late failure is swallowed the same way
 *   (no toast-bound throw for a dialog the user already dismissed).
 * - CR-3 control: a live signal commits exactly as a no-signal call does. The
 *   no-signal path itself stays pinned by d20-reopen-dirty-hook (`ENTRIES.encoding`)
 *   and d15-reopen-in-place R3.
 * - CR-4 supersession, at the level that owns it: `supersedeRetry` (the helper App's
 *   ref goes through) aborts the previous controller; two overlapping hook retries
 *   where the older read lands LAST leave only the newer one committed.
 * - CR-5 `encodingReopenOutcome` maps `cancelled` to no toast, no recent path, and
 *   does not clear the issue (a superseded retry must not close the dialog under
 *   the newer one).
 * - CR-6 App.tsx wiring (source contract: App cannot render in jsdom, same precedent
 *   as d20-encoding-refusal-message C-3): the retry takes its signal from
 *   `supersedeRetry(encodingRetryRef)`, the dialog's single cancel handler aborts
 *   `encodingRetryRef.current`, and the issue is cleared only when the outcome says so.
 *
 * Mock boundary: `@tauri-apps/api/{core,event,window}` and `loggingService`.
 */
import { act, renderHook } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, sink } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  sink: {
    generateActionId: vi.fn(() => "test-id"),
    logEvent: vi.fn(async () => {}),
    logEventSync: vi.fn(),
    logUiEvent: vi.fn(() => "test-id"),
    logDialogAction: vi.fn(),
    logButtonClick: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));

import { supersedeRetry, useDocument } from "../src/hooks/useDocument";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import type { Document } from "../src/types/document";
import { encodingReopenOutcome } from "../src/utils/openWriteGuard";

const GBK_PATH = "/x/gb.md";
const ISSUE = { path: GBK_PATH, detected: "unknown" };
const encErr = { EncodingError: { path: GBK_PATH, detected: "unknown" } };

type Deferred = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
let pending: Deferred[] = [];

function doc(id: string, content: string, p: string | null): Document {
  return { id, path: p, content, encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null };
}
const decoded = (content: string, encoding: string) => ({
  document: { ...doc("doc-gb", content, GBK_PATH), encoding },
});

const cancelLogs = () =>
  sink.logEventSync.mock.calls
    .map((c) => c[0] as { event: string; status: string; context?: Record<string, unknown> })
    .filter((e) => e.event === "file.open.encoding_retry");

/** The first `open_file` fails to decode (raising the issue); later ones wait for the test. */
async function mountWithIssue() {
  let first = true;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd !== "open_file") return Promise.resolve(null);
    if (first) {
      first = false;
      return Promise.reject(encErr);
    }
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  });
  const hook = renderHook(() => useDocument());
  await act(async () => { await hook.result.current.openDocumentFromPath(GBK_PATH); });
  expect(hook.result.current.encodingIssue).toEqual(ISSUE);
  return hook;
}

beforeEach(() => {
  invokeMock.mockReset();
  sink.logEventSync.mockClear();
  pending = [];
  useDocumentStore.setState({ documents: [doc("doc-b", "B", null)], activeDocumentId: "doc-b" });
  useEditorStore.setState({ activeDocumentId: "doc-b", viewMode: "source" });
});

describe("CR-1/2/3 openDocumentWithEncoding honours its abort signal", () => {
  it("CR-1 aborted before the read resolves: nothing committed, issue kept, cancel logged", async () => {
    const { result, unmount } = await mountWithIssue();
    const before = structuredClone(useDocumentStore.getState().documents);
    const ctrl = new AbortController();
    let p!: Promise<unknown>;
    act(() => { p = result.current.openDocumentWithEncoding(GBK_PATH, "GBK", undefined, ctrl.signal); });
    expect(pending).toHaveLength(1);

    ctrl.abort();
    let out: unknown;
    await act(async () => { pending[0].resolve(decoded("LATE", "GBK")); out = await p; });

    expect(out).toEqual({ kind: "cancelled" });
    expect(useDocumentStore.getState().documents).toEqual(before);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-b");
    expect(result.current.encodingIssue).toEqual(ISSUE);
    const logs = cancelLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: "cancel", context: { reason: "cancelled-before-commit" } });
    unmount();
  });

  it("CR-2 aborted before the read rejects: resolves cancelled instead of throwing", async () => {
    const { result, unmount } = await mountWithIssue();
    const ctrl = new AbortController();
    let p!: Promise<unknown>;
    act(() => { p = result.current.openDocumentWithEncoding(GBK_PATH, "UTF-16LE", undefined, ctrl.signal); });

    ctrl.abort();
    let out: unknown;
    let caught: unknown = null;
    await act(async () => {
      pending[0].reject(encErr);
      out = await p.catch((e: unknown) => { caught = e; });
    });

    expect(caught).toBeNull();
    expect(out).toEqual({ kind: "cancelled" });
    expect(result.current.encodingIssue).toEqual(ISSUE);
    expect(cancelLogs()).toHaveLength(1);
    unmount();
  });

  it("CR-3 a live (never aborted) signal commits like a no-signal call", async () => {
    const { result, unmount } = await mountWithIssue();
    const ctrl = new AbortController();
    let p!: Promise<unknown>;
    act(() => { p = result.current.openDocumentWithEncoding(GBK_PATH, "GBK", undefined, ctrl.signal); });
    let out: unknown;
    await act(async () => { pending[0].resolve(decoded("OK", "GBK")); out = await p; });

    expect(out).toMatchObject({ kind: "opened", document: { id: "doc-gb", content: "OK" } });
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-gb");
    expect(result.current.encodingIssue).toBeNull();
    expect(cancelLogs()).toHaveLength(0);
    unmount();
  });
});

describe("CR-4 a newer retry supersedes an older one", () => {
  it("supersedeRetry aborts the previous controller and hands out a live signal", () => {
    const ref: { current: AbortController | null } = { current: null };
    const first = supersedeRetry(ref);
    expect(first.aborted).toBe(false);
    const second = supersedeRetry(ref);
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(ref.current?.signal).toBe(second);
  });

  it("the older read landing last does not overwrite the newer commit", async () => {
    const { result, unmount } = await mountWithIssue();
    const ref: { current: AbortController | null } = { current: null };
    let p1!: Promise<unknown>;
    let p2!: Promise<unknown>;
    act(() => { p1 = result.current.openDocumentWithEncoding(GBK_PATH, "GBK", undefined, supersedeRetry(ref)); });
    act(() => { p2 = result.current.openDocumentWithEncoding(GBK_PATH, "Big5", undefined, supersedeRetry(ref)); });
    expect(pending).toHaveLength(2);

    let out1: unknown;
    let out2: unknown;
    await act(async () => { pending[1].resolve(decoded("NEWER", "Big5")); out2 = await p2; });
    await act(async () => { pending[0].resolve(decoded("OLDER", "GBK")); out1 = await p1; });

    expect(out2).toMatchObject({ kind: "opened" });
    expect(out1).toEqual({ kind: "cancelled" });
    const gb = useDocumentStore.getState().documents.find((d) => d.id === "doc-gb");
    expect(gb).toMatchObject({ content: "NEWER", encoding: "Big5" });
    expect(cancelLogs()).toHaveLength(1);
    unmount();
  });
});

describe("CR-5 encodingReopenOutcome for a cancelled retry", () => {
  it("no toast, no recent path, and the issue is not cleared", () => {
    expect(encodingReopenOutcome({ kind: "cancelled" })).toEqual({
      toast: null,
      recentPath: null,
      clearIssue: false,
    });
  });
});

describe("CR-6 App.tsx wires the retry controller (source contract)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf-8");
  const start = src.indexOf("const handleEncodingSelect");
  const end = src.indexOf("useCallback(", src.indexOf("useCallback(", start) + 1);
  const select = start >= 0 && end > start ? src.slice(start, end) : "";

  it("holds one controller ref", () => {
    expect(src).toMatch(/const encodingRetryRef = useRef<AbortController \| null>\(null\);/);
  });

  it("each retry passes a superseding signal and clears the issue only when told to", () => {
    expect(select).toMatch(/openDocumentWithEncoding\(\s*encodingIssue\.path,\s*encoding,\s*undefined,\s*supersedeRetry\(encodingRetryRef\)/);
    expect(select).toMatch(/if \(clearIssue\) clearEncodingIssue\(\);/);
  });

  it("the dialog's single cancel handler aborts the pending retry, then clears the issue", () => {
    expect(src).toMatch(/onEncodingCancel=\{handleEncodingCancel\}/);
    const at = src.indexOf("const handleEncodingCancel");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf(";", src.indexOf("[", at)) + 1);
    expect(body).toMatch(/encodingRetryRef\.current\?\.abort\(\)/);
    expect(body).toContain("clearEncodingIssue()");
    expect(body.indexOf("abort()")).toBeLessThan(body.indexOf("clearEncodingIssue()"));
  });
});
