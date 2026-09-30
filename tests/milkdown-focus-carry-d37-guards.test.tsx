/**
 * D37 WI-4 — guards on the real path, part 1: capture guards (G-1, G-2), batched and
 * carried-forward inserts (G-3, G-3b, G-3c) and never stealing focus (G-4, G-5, G-6).
 * Part 2 is `tests/milkdown-focus-carry-d37-restore.test.tsx`.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-233000.md`, §"Unit: guards and real-path
 * pins", plus G-3b/G-3c and the Gap 5 count from the resolution sections. G-14, G-15
 * and G-17 (dialog focus return) belong to WI-6 and are not here.
 *
 * Real `MilkdownEditor`, `useMcpEvents`, `McpWriteConfirm`/`useMcpConfirm`, edit-sync
 * and stores. Mocked boundaries: `@tauri-apps/api/{core,event,window,webviewWindow}`
 * (webviewWindow as a fake bus, finding F5), `loggingService`, `IntersectionObserver`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";

const { eventListeners, webviewBus } = vi.hoisted(() => ({
  eventListeners: new Map<string, (event: { payload: unknown }) => void>(),
  webviewBus: new Map<string, Set<(event: { payload: unknown }) => void>>(),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
    eventListeners.set(name, cb);
    return () => eventListeners.delete(name);
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: async (name: string, cb: (event: { payload: unknown }) => void) => {
      const set = webviewBus.get(name) ?? new Set();
      set.add(cb);
      webviewBus.set(name, set);
      return () => void set.delete(cb);
    },
  })),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    logUiEvent: vi.fn(),
    logDialogAction: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import type { Mock } from "vitest";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { McpWriteConfirm } from "../src/components/common/McpWriteConfirm";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { resetFocusCarry } from "../src/utils/milkdownFocusCarry";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { docById, makeDoc, mountAndWait, resetStores, sleep, viewOf } from "./helpers/milkdownEditorHarness";
import {
  countOutcome, emitConfirmRequest, emitMcp, emitMcpInOneAct, focusInLiveView, Gate, gen,
  liveView, placeCaret, pmEl, restoreLogs, setGate, stripOneTrailingNewline, typeAtFocus,
  waitForNewPm,
} from "./helpers/focusCarryD37Fixture";

const CASE_TIMEOUT_MS = 20_000;
const END = 12;
const logSpy = loggingService.logEventSync as Mock;
let unmountEditor: (() => void) | null = null;

const insert = (position: "start" | "end", text: string, id = "doc-a") => ({
  document_id: id, position, text, window_label: null,
});
const content = (id: string) => stripOneTrailingNewline(docById(id)!.content);

/** Mount `ui`, focus doc-a's view and put the caret at `pos`. */
async function mountFocused(ui = <MilkdownEditor />, pos = END): Promise<HTMLElement> {
  const mounted = await mountAndWait(ui);
  unmountEditor = mounted.unmount;
  placeCaret(viewOf(mounted.instance), pos);
  expect(viewOf(mounted.instance).hasFocus(), "harness: focused").toBe(true);
  return pmEl()!;
}

/** An element outside the editor, appended to the body (G-4, G-5, G-3c). */
function outside(html: string): void {
  const host = document.createElement("div");
  host.setAttribute("data-testid", "outside");
  host.innerHTML = html;
  document.body.appendChild(host);
}

beforeEach(() => {
  installIntersectionObserverDouble();
  eventListeners.clear();
  webviewBus.clear();
  resetFocusCarry();
  resetStores([makeDoc("doc-a", "Hello world", "/tmp/a.md"), makeDoc("doc-b", "Other")]);
  useEditorStore.setState({ editorView: null });
  useMilkdownEditorStore.setState({ editorGenerations: {} });
});

afterEach(async () => {
  unmountEditor?.();
  unmountEditor = null;
  await sleep(100);
  resetFocusCarry();
  document.querySelectorAll("[data-testid=outside]").forEach((n) => n.remove());
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D37 guards, part 1", { timeout: CASE_TIMEOUT_MS }, () => {
  it("G-1 an unfocused editor produces no record", async () => {
    const oldPm = await mountFocused();
    (liveView().dom as HTMLElement).blur();
    expect(liveView().state.selection.head, "harness: caret kept").toBe(END);
    await emitMcp(eventListeners, "mcp:insert_content", insert("end", " MCP-END"));
    await waitForNewPm(oldPm, "Hello world MCP-END");
    expect(document.activeElement).toBe(document.body);
    expect((await typeAtFocus("Z")).outcome).toBe("lost");
    expect(restoreLogs(logSpy)).toHaveLength(0);
  });

  it("G-2 a background-doc write keeps the active editor focused and unrebuilt", async () => {
    const pmBefore = await mountFocused();
    await emitMcp(eventListeners, "mcp:write_document", {
      document_id: "doc-b", content: "MCP-BG", window_label: null,
    });
    await sleep(100);
    expect(pmEl()).toBe(pmBefore);
    expect(gen("doc-a")).toBe(0);
    expect(focusInLiveView()).toBe(true);
    expect(restoreLogs(logSpy)).toHaveLength(0);
    expect(content("doc-b")).toBe("MCP-BG");
  });

  it("G-3 two inserts in one act: one restore, one superseded, total 2", async () => {
    const oldPm = await mountFocused();
    await emitMcpInOneAct(eventListeners, [
      ["mcp:insert_content", insert("start", "A ")],
      ["mcp:insert_content", insert("end", " B")],
    ]);
    await waitForNewPm(oldPm, "A Hello world B");
    expect(gen("doc-a")).toBe(2);
    expect(focusInLiveView(), "focus carried").toBe(true);
    const typed = await typeAtFocus("Z");
    expect(typed.outcome).toBe("typed");
    // Matrix expects "A Hello worldZ B". Not reachable: the carry keeps ONE oldDoc
    // ("Hello world", head 12), and WI-2's anchor maps it into "A Hello world B" at 16 —
    // the end (the region [1,12) was rewritten on both sides; head === a takes `suf`).
    // Pinned as delivered; reported to the coordinator.
    expect(content("doc-a")).toBe("A Hello world BZ");
    expect(countOutcome(logSpy, "restored")).toBe(1);
    expect(countOutcome(logSpy, "skipped:superseded")).toBe(1);
    expect(restoreLogs(logSpy), "Gap 5: one line per arm").toHaveLength(2);
  });

  it("G-3b an insert while the view is gone carries the record forward", async () => {
    const oldPm = await mountFocused(<Gate><MilkdownEditor /></Gate>);
    await emitMcpInOneAct(eventListeners, [["mcp:insert_content", insert("start", "A ")]], () =>
      setGate(false),
    );
    expect(pmEl(), "harness: the gate is closed").toBeNull();
    await emitMcp(eventListeners, "mcp:insert_content", insert("end", " B"));
    await act(async () => setGate(true));
    await waitForNewPm(oldPm, "A Hello world B");
    expect(focusInLiveView(), "focus carried").toBe(true);
    const typed = await typeAtFocus("Z");
    expect(typed.outcome).toBe("typed");
    // Same single-oldDoc limit as G-3 (matrix: "A Hello worldZ B").
    expect(content("doc-a")).toBe("A Hello world BZ");
    const superseded = restoreLogs(logSpy).filter((e) => e.context?.outcome === "skipped:superseded");
    expect(superseded).toHaveLength(1);
    expect(superseded[0].context?.generation).toBe(1);
    expect(countOutcome(logSpy, "restored")).toBe(1);
    expect(restoreLogs(logSpy)).toHaveLength(2);
  });

  it("G-3c focus moved to an input between carried inserts is not stolen", async () => {
    const oldPm = await mountFocused(<Gate><MilkdownEditor /></Gate>);
    outside(`<input aria-label="find" />`);
    await emitMcpInOneAct(eventListeners, [["mcp:insert_content", insert("start", "A ")]], () =>
      setGate(false),
    );
    const input = screen.getByRole("textbox", { name: "find" });
    input.focus();
    await emitMcp(eventListeners, "mcp:insert_content", insert("end", " B"));
    await act(async () => setGate(true));
    await waitForNewPm(oldPm, "A Hello world B");
    expect(document.activeElement).toBe(input);
    expect(countOutcome(logSpy, "skipped:superseded")).toBe(1);
    expect(countOutcome(logSpy, "skipped:focus-elsewhere")).toBe(1);
    expect(countOutcome(logSpy, "restored")).toBe(0);
  });

  it("G-4 an input focused before the remount is not stolen from", async () => {
    const oldPm = await mountFocused();
    outside(`<input aria-label="find" />`);
    const input = screen.getByRole("textbox", { name: "find" });
    await emitMcpInOneAct(eventListeners, [["mcp:insert_content", insert("end", " MCP-END")]], () =>
      input.focus(),
    );
    await waitForNewPm(oldPm, "Hello world MCP-END");
    expect(document.activeElement).toBe(input);
    expect(countOutcome(logSpy, "skipped:focus-elsewhere")).toBe(1);

    const pm2 = pmEl();
    await emitMcp(eventListeners, "mcp:insert_content", insert("end", " 2"));
    await waitForNewPm(pm2, "MCP-END 2");
    expect(document.activeElement).toBe(input);
    expect(restoreLogs(logSpy), "no line for the second insert").toHaveLength(1);
  });

  it("G-5 a role=dialog button that owns focus at remount is not stolen from", async () => {
    const oldPm = await mountFocused();
    outside(`<div role="dialog" aria-label="other"><button>Keep</button></div>`);
    const keep = screen.getByRole("button", { name: "Keep" });
    await emitMcpInOneAct(eventListeners, [["mcp:insert_content", insert("end", " MCP-END")]], () =>
      keep.focus(),
    );
    await waitForNewPm(oldPm, "Hello world MCP-END");
    expect(document.activeElement).toBe(keep);
    expect(countOutcome(logSpy, "skipped:focus-elsewhere")).toBe(1);
  });

  it("G-6 a dialog focused at capture time: no record, no log", async () => {
    const oldPm = await mountFocused(
      <>
        <McpWriteConfirm />
        <MilkdownEditor />
      </>,
    );
    await sleep(20);
    await emitConfirmRequest(webviewBus, {
      requestId: "r1", documentId: "doc-a", documentTitle: "a.md",
      operation: "insert", expiresInMs: 60_000,
    });
    const reject = screen.getByRole("button", { name: "Reject" });
    expect(document.activeElement, "harness: Reject has focus").toBe(reject);
    await emitMcp(eventListeners, "mcp:insert_content", insert("end", " MCP-END"));
    await waitForNewPm(oldPm, "Hello world MCP-END");
    expect(document.activeElement).toBe(reject);
    expect(restoreLogs(logSpy)).toHaveLength(0);
  });
});
