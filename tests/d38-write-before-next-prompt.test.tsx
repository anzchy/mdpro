/**
 * D38R-WI-1 — the approved write lands BEFORE the next queued prompt exists.
 *
 * Real Rust shows one confirm prompt at a time: replying to r1 wakes r1's writer before
 * r2's `mcp:confirm_request` is drained. So r1's `mcp:insert_content` can reach the window
 * while focus is back on the old editor (prompt 1's return-focus), and r2's prompt mounts
 * in the same render as the rebuild (H3a: its saved prior is the old editor, now gone) or
 * after it (H3b: focus on body, nothing saved). Either way, closing r2's prompt must put
 * the caret back where the user left it, mapped across the write — not at the end, and
 * not nowhere. The existing D38 suite emits every confirm request before the first click,
 * which real Rust never does.
 *
 * Guard: a prompt opened from a still-connected outside input still leaves focus alone
 * (`skipped:focus-elsewhere`) and returns focus to that input.
 *
 * Real `MilkdownEditor`, `useMcpEvents`, `McpWriteConfirm`/`useMcpConfirm`, edit-sync and
 * stores. Mocked boundaries: `@tauri-apps/api/{core,event,window,webviewWindow}`,
 * `loggingService`, `IntersectionObserver` (the D38 harness).
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
import { McpWriteConfirm } from "../src/components/common/McpWriteConfirm";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { resetFocusCarry } from "../src/utils/milkdownFocusCarry";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { docById, makeDoc, mountAndWait, resetStores, sleep, viewOf } from "./helpers/milkdownEditorHarness";
import {
  countOutcome, emitConfirmRequest, emitMcpInOneAct, focusInLiveView, Gate, liveView, placeCaret,
  pmEl, restoreLogs, setGate, stripOneTrailingNewline, typeAtFocus, waitForNewPm,
} from "./helpers/focusCarryD37Fixture";

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
const INSERT_ONE = { document_id: "doc-a", position: "start", text: "ONE ", window_label: null };
const fallbackLines = () =>
  uiLogSpy.mock.calls.filter((c) => c[0] === "ui.mcp_confirm.focus_return" && c[1]?.outcome === "fallback");
const linesWith = (outcome: string) => restoreLogs(logSpy).filter((e) => e.context?.outcome === outcome);
const button = (name: "Approve" | "Reject") => screen.getByRole("button", { name });

/** Deliver `mcp:confirm_request` synchronously (inside a caller's `act`). */
function deliverConfirm(requestId: string): void {
  for (const cb of [...(webviewBus.get("mcp:confirm_request") ?? [])]) cb({ payload: confirm(requestId) });
}

async function click(name: "Approve" | "Reject"): Promise<void> {
  await userEvent.setup().click(button(name));
}

/** Mount the confirm container, the editor (inside a `Gate`) and `extra`; caret at MID. */
async function mount(extra?: ReactNode): Promise<void> {
  const mounted = await mountAndWait(
    <>
      <McpWriteConfirm />
      <Gate><MilkdownEditor /></Gate>
      {extra}
    </>,
  );
  unmountEditor = mounted.unmount;
  await sleep(20);
  placeCaret(viewOf(mounted.instance), MID);
  expect(viewOf(mounted.instance).hasFocus(), "harness: focused").toBe(true);
}

/** r1 alone is queued (real Rust); approve it, so focus goes back to the old editor. */
async function approveOnlyPrompt(): Promise<void> {
  await emitConfirmRequest(webviewBus, confirm("r1"));
  expect(screen.getAllByRole("dialog"), "harness: one prompt").toHaveLength(1);
  await click("Approve");
  expect(screen.queryByRole("dialog"), "harness: no prompt between replies").toBeNull();
  expect(focusInLiveView(), "harness: prompt 1 returned focus to the editor").toBe(true);
}

/** After prompt 2 closed: focus in the live editor at the mapped caret, Z lands there. */
async function expectCaretMappedAndTypable(): Promise<void> {
  expect(screen.queryByRole("dialog"), "harness: queue drained").toBeNull();
  expect(focusInLiveView(), "focus is in the rebuilt editor").toBe(true);
  expect(liveView().state.selection.head, "caret mapped across the write").toBe(MID + 4);
  const typed = await typeAtFocus("Z");
  expect(typed.outcome).toBe("typed");
  expect(content("doc-a")).toBe("ONE HelloZ world");
  expect(fallbackLines(), "the end fallback was not taken").toHaveLength(0);
}

const RANGE_LAYOUT = ["getClientRects", "getBoundingClientRect"] as const;
let rangeShimmed: string[] = [];

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

describe("D38R a write landing before the next prompt keeps the caret", { timeout: CASE_TIMEOUT_MS }, () => {
  /** H3a: r1's write and r2's request arrive together; prompt 2 saves the old editor. */
  async function writeThenNextPromptInOneRender(): Promise<void> {
    await mount();
    await approveOnlyPrompt();
    const oldPm = pmEl();
    await emitMcpInOneAct(eventListeners, [["mcp:insert_content", INSERT_ONE]], () => deliverConfirm("r2"));
    await waitForNewPm(oldPm, "ONE Hello world");
    await sleep(20);
    expect(document.activeElement, "prompt 2 holds focus").toBe(button("Reject"));
  }

  it("D38R-A approve r2: the caret is the mapped original and the restore deferred to the prompt", async () => {
    await writeThenNextPromptInOneRender();
    await click("Approve");
    await expectCaretMappedAndTypable();
    const restored = linesWith("restored");
    expect(restored, "one restore").toHaveLength(1);
    expect(restored[0].context).toMatchObject({ focus: "deferred", active: "prompt", promptTarget: "old-editor" });
    expect(countOutcome(logSpy, "skipped:focus-elsewhere")).toBe(0);
  });

  it("D38R-A2 reject r2: also returns to the mapped caret", async () => {
    await writeThenNextPromptInOneRender();
    await click("Reject");
    await expectCaretMappedAndTypable();
    expect(linesWith("restored")[0]?.context?.focus).toBe("deferred");
  });

  it("D38R-B prompt 2 mounts after the old editor is gone (focus on body): closing it lands at the caret", async () => {
    await mount();
    await approveOnlyPrompt();
    const pm0 = pmEl();
    await emitMcpInOneAct(eventListeners, [["mcp:insert_content", INSERT_ONE]], () => setGate(false));
    expect(document.activeElement, "harness: old editor gone, focus on body").toBe(document.body);
    await emitConfirmRequest(webviewBus, confirm("r2"));
    expect(document.activeElement, "harness: prompt 2 holds focus").toBe(button("Reject"));
    await act(async () => setGate(true));
    await waitForNewPm(pm0, "ONE Hello world");
    await sleep(20);
    expect(document.activeElement, "the restore did not steal focus from prompt 2").toBe(button("Reject"));
    await click("Approve");
    await expectCaretMappedAndTypable();
    expect(linesWith("restored")[0]?.context).toMatchObject({ focus: "deferred", promptTarget: "empty" });
  });
});

describe("D38R guard: a prompt returning to a live outside element is never robbed", { timeout: CASE_TIMEOUT_MS }, () => {
  it("D38R-G a prompt opened from a connected input: skipped:focus-elsewhere, focus back to the input", async () => {
    await mount(<input aria-label="outside" />);
    const pm0 = pmEl();
    await emitMcpInOneAct(eventListeners, [["mcp:insert_content", INSERT_ONE]], () => setGate(false));
    const input = screen.getByRole("textbox", { name: "outside" });
    act(() => input.focus());
    await emitConfirmRequest(webviewBus, confirm("r1"));
    await act(async () => setGate(true));
    await waitForNewPm(pm0, "ONE Hello world");
    await sleep(20);
    const skipped = linesWith("skipped:focus-elsewhere");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].context).toMatchObject({ active: "prompt", promptTarget: "other" });
    expect(countOutcome(logSpy, "restored")).toBe(0);
    await click("Approve");
    expect(document.activeElement, "the prompt returns to where it was opened").toBe(input);
    expect(fallbackLines()).toHaveLength(0);
  });
});
