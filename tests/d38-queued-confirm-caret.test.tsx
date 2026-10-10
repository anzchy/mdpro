/**
 * D38 — queued MCP confirm prompts: after the second approval the caret must be where
 * the user left it (mapped across the approved write, the same contract G-14 pins for a
 * single approval), not at the end of the document.
 *
 * Mechanism (sequencing row D38): approving r1 hands focus straight to r2, so the
 * rebuild for r1's write sees an unfocused editor and arms no carry; r2's return target
 * is the torn-down view, and its close falls back to `focusActiveMilkdownAtEnd`.
 *
 * Guards: an unrelated dialog, or an MCP prompt whose return target is outside the
 * editor, records nothing; a genuinely lost target still takes the end fallback.
 * D38-G4 (added after the red): a carry armed from the focused editor is not handed to
 * a prompt opened elsewhere before the rebuild.
 *
 * Real `MilkdownEditor`, `useMcpEvents`, `McpWriteConfirm`/`useMcpConfirm`, edit-sync and
 * stores. Mocked boundaries: `@tauri-apps/api/{core,event,window,webviewWindow}`,
 * `loggingService`, `IntersectionObserver` (the D37 dialog-suite harness).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
import type { ReactNode } from "react";
import { TextSelection } from "@milkdown/kit/prose/state";
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
  countOutcome, emitConfirmRequest, emitMcp, focusInLiveView, liveView, placeCaret, pmEl,
  restoreLogs, stripOneTrailingNewline, typeAtFocus, waitForNewPm,
} from "./helpers/focusCarryD37Fixture";
import { emitMcpInOneAct, Gate, setGate } from "./helpers/focusCarryD37Fixture";

const CASE_TIMEOUT_MS = 20_000;
/** Between "Hello" and " world": a mid-document caret. */
const MID = 6;
const logSpy = loggingService.logEventSync as Mock;
const uiLogSpy = loggingService.logUiEvent as Mock;
let unmountEditor: (() => void) | null = null;

const content = (id: string) => stripOneTrailingNewline(docById(id)!.content);
const confirm = (requestId: string) => ({
  requestId, documentId: "doc-a", documentTitle: "doc-a.md", operation: "insert", expiresInMs: 60_000,
});
const insert = (position: "start" | "end", text: string) => ({
  document_id: "doc-a", position, text, window_label: null,
});
const fallbackLines = () =>
  uiLogSpy.mock.calls.filter((c) => c[0] === "ui.mcp_confirm.focus_return" && c[1]?.outcome === "fallback");

/** Mount the confirm container, the editor and `extra`; focus doc-a with the caret at MID. */
async function mount(extra?: ReactNode): Promise<HTMLElement> {
  const mounted = await mountAndWait(
    <>
      <McpWriteConfirm />
      <MilkdownEditor />
      {extra}
    </>,
  );
  unmountEditor = mounted.unmount;
  await sleep(20);
  placeCaret(viewOf(mounted.instance), MID);
  expect(viewOf(mounted.instance).hasFocus(), "harness: focused").toBe(true);
  return pmEl()!;
}

const RANGE_LAYOUT = ["getClientRects", "getBoundingClientRect"] as const;
let rangeShimmed: string[] = [];

async function click(name: "Approve" | "Reject"): Promise<void> {
  await userEvent.setup().click(screen.getByRole("button", { name }));
}

/** Queue `ids`, approve the first, and land its MCP insert while the next prompt has focus. */
async function approveFirstThenWrite(ids: string[], position: "start" | "end", text: string, expected: string) {
  const oldPm = pmEl();
  for (const id of ids) await emitConfirmRequest(webviewBus, confirm(id));
  await click("Approve");
  expect(document.activeElement, "harness: the next prompt's Reject has focus").toBe(
    screen.getByRole("button", { name: "Reject" }),
  );
  await emitMcp(eventListeners, "mcp:insert_content", insert(position, text));
  await waitForNewPm(oldPm, expected);
  await sleep(20);
}

beforeEach(() => {
  const proto = Range.prototype as unknown as Record<string, unknown>;
  rangeShimmed = RANGE_LAYOUT.filter((name) => typeof proto[name] !== "function");
  for (const name of rangeShimmed) {
    proto[name] = name === "getClientRects" ? () => [] : () => new DOMRect(0, 0, 0, 0);
  }
  installIntersectionObserverDouble();
  eventListeners.clear();
  webviewBus.clear();
  resetFocusCarry();
  resetStores([makeDoc("doc-a", "Hello world", "/tmp/a.md")]);
  useEditorStore.setState({ editorView: null });
  useMilkdownEditorStore.setState({ editorGenerations: {} });
});

afterEach(async () => {
  await sleep(50);
  unmountEditor?.();
  unmountEditor = null;
  await sleep(100);
  const proto = Range.prototype as unknown as Record<string, unknown>;
  for (const name of rangeShimmed) delete proto[name];
  rangeShimmed = [];
  resetFocusCarry();
  vi.restoreAllMocks();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D38 queued confirm prompts keep the caret", { timeout: CASE_TIMEOUT_MS }, () => {
  it("D38-1 approve, write at start, approve: the caret is the mapped original, not the end", async () => {
    await mount();
    await approveFirstThenWrite(["r1", "r2"], "start", "ONE ", "ONE Hello world");
    await click("Approve");
    expect(screen.queryByRole("dialog"), "harness: queue drained").toBeNull();
    expect(focusInLiveView(), "focus is in the rebuilt editor").toBe(true);
    expect(liveView().state.selection.head, "caret mapped across the write").toBe(MID + 4);
    const typed = await typeAtFocus("Z");
    expect(typed.outcome).toBe("typed");
    expect(content("doc-a")).toBe("ONE HelloZ world");
    expect(countOutcome(logSpy, "restored")).toBe(1);
    expect(fallbackLines(), "the end fallback was not taken").toHaveLength(0);
  });

  it("D38-2 write at end, then a focused second write: the text lands mid-document once", async () => {
    await mount();
    await approveFirstThenWrite(["r1", "r2"], "end", " ONE", "Hello world ONE");
    await click("Approve");
    expect(liveView().state.selection.head, "caret where it was").toBe(MID);
    const pm1 = pmEl();
    await emitMcp(eventListeners, "mcp:insert_content", insert("start", "TWO "));
    await waitForNewPm(pm1, "TWO Hello world ONE");
    const typed = await typeAtFocus("Z");
    expect(typed.outcome).toBe("typed");
    expect(content("doc-a")).toBe("TWO HelloZ world ONE");
  });

  it("D38-3 rejecting the second prompt also returns to the mapped caret", async () => {
    await mount();
    await approveFirstThenWrite(["r1", "r2"], "start", "ONE ", "ONE Hello world");
    await click("Reject");
    expect(focusInLiveView()).toBe(true);
    const typed = await typeAtFocus("Z");
    expect(typed.outcome).toBe("typed");
    expect(content("doc-a")).toBe("ONE HelloZ world");
  });

  it("D38-4 three queued prompts, two writes landing under a prompt: the caret survives both", async () => {
    await mount();
    await approveFirstThenWrite(["r1", "r2", "r3"], "start", "ONE ", "ONE Hello world");
    const pm1 = pmEl();
    await click("Approve");
    expect(document.activeElement, "harness: r3's Reject has focus").toBe(
      screen.getByRole("button", { name: "Reject" }),
    );
    await emitMcp(eventListeners, "mcp:insert_content", insert("start", "TWO "));
    await waitForNewPm(pm1, "TWO ONE Hello world");
    await sleep(20);
    await click("Approve");
    expect(focusInLiveView()).toBe(true);
    const typed = await typeAtFocus("Z");
    expect(typed.outcome).toBe("typed");
    expect(content("doc-a")).toBe("TWO ONE HelloZ world");
    expect(fallbackLines()).toHaveLength(0);
  });
});

describe("D38 guards: only a prompt returning into this editor counts", { timeout: CASE_TIMEOUT_MS }, () => {
  it("D38-G1 focus in an unrelated dialog: no carry is recorded and focus stays there", async () => {
    const oldPm = await mount(
      <div role="dialog" aria-label="Other">
        <button type="button">Other</button>
      </div>,
    );
    const other = screen.getByRole("button", { name: "Other" });
    act(() => other.focus());
    await emitMcp(eventListeners, "mcp:insert_content", insert("start", "ONE "));
    await waitForNewPm(oldPm, "ONE Hello world");
    await sleep(20);
    expect(restoreLogs(logSpy), "nothing armed").toHaveLength(0);
    expect(document.activeElement).toBe(other);
  });

  it("D38-G2 queued prompts opened from an input outside the editor: nothing recorded, focus back to the input", async () => {
    await mount(<input aria-label="outside" />);
    const input = screen.getByRole("textbox", { name: "outside" });
    act(() => input.focus());
    await approveFirstThenWrite(["r1", "r2"], "start", "ONE ", "ONE Hello world");
    expect(restoreLogs(logSpy), "nothing armed").toHaveLength(0);
    await click("Approve");
    expect(document.activeElement).toBe(input);
    expect(fallbackLines()).toHaveLength(0);
  });

  it("D38-G4 a focused-editor carry is not handed to a prompt opened from an input meanwhile", async () => {
    const mounted = await mountAndWait(
      <>
        <McpWriteConfirm />
        <Gate><MilkdownEditor /></Gate>
        <input aria-label="outside" />
      </>,
    );
    unmountEditor = mounted.unmount;
    await sleep(20);
    placeCaret(viewOf(mounted.instance), MID);
    const pm0 = pmEl();
    await emitMcpInOneAct(eventListeners, [["mcp:insert_content", insert("start", "ONE ")]], () =>
      setGate(false),
    );
    const input = screen.getByRole("textbox", { name: "outside" });
    act(() => input.focus());
    await emitConfirmRequest(webviewBus, confirm("r1"));
    await act(async () => setGate(true));
    await waitForNewPm(pm0, "ONE Hello world");
    await sleep(20);
    expect(countOutcome(logSpy, "skipped:focus-elsewhere")).toBe(1);
    expect(countOutcome(logSpy, "restored")).toBe(0);
    await click("Approve");
    expect(document.activeElement, "the prompt returns to where it was opened").toBe(input);
  });

  it("D38-G3 a genuinely lost target still takes the end fallback", async () => {
    await mount();
    const gone = document.body.appendChild(document.createElement("button"));
    gone.textContent = "Gone";
    act(() => gone.focus());
    await emitConfirmRequest(webviewBus, confirm("r1"));
    gone.remove();
    await click("Approve");
    expect(focusInLiveView(), "fallback: the editor").toBe(true);
    const view = liveView();
    expect(view.state.selection.head).toBe(TextSelection.atEnd(view.state.doc).head);
    expect(fallbackLines()).toHaveLength(1);
  });
});
