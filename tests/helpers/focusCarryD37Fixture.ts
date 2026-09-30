/**
 * Purpose: shared fixture for the D37 focus-carry suites
 * (`tests/milkdown-focus-carry-d37-*.test.tsx`), per matrix
 * `.claude/tdd-guardian/tests-20260930-233000.md` §"Shared fixture".
 *
 * Holds no mocks: `vi.mock` is hoisted per file, so each test file mocks
 * `@tauri-apps/api/*` and `loggingService` itself and hands this fixture its fake event
 * bus (`emitMcp`) and its recording log spy (`restoreLogs`). Every store, the real
 * `MilkdownEditor`, the edit-sync plugin and `useMcpEvents` are real.
 *
 * Key decisions:
 * - `typeAtFocus` is focus-gated (finding F4): a real keystroke goes to
 *   `document.activeElement`, so it dispatches only when focus is inside the live view's
 *   `view.dom`. Otherwise it returns `"lost"` and dispatches nothing. An ungated
 *   `view.dispatch` lands whether or not the view has focus and would hide the defect.
 * - `stripOneTrailingNewline` is the only content normalisation allowed.
 */
import type { Mock } from "vitest";
import { createElement, Fragment, useState, type ReactElement, type ReactNode } from "react";
import type { Transaction } from "@milkdown/kit/prose/state";
import { expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import type { Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { useMcpEvents } from "../../src/hooks/useMcpEvents";
import { useMilkdownEditorStore } from "../../src/stores/milkdownEditorStore";
import type { FlushResult } from "../../src/stores/milkdownEditorStore";
import { viewOf } from "./milkdownEditorHarness";

/** The fake `@tauri-apps/api/event` bus a test file builds in `vi.hoisted`. */
export type EventBus = Map<string, (event: { payload: unknown }) => void>;

export const RESTORE_EVENT = "editor.milkdown.focus.restore";

/** The live (store-registered) Milkdown editor, or null. */
export const liveEditor = (): Editor | null =>
  (useMilkdownEditorStore.getState().getEditor() as Editor | null) ?? null;

/** The live editor's ProseMirror view. Throws if no editor is registered. */
export function liveView(): EditorView {
  const instance = liveEditor();
  if (!instance) throw new Error("liveView: no Milkdown editor is registered");
  return viewOf(instance);
}

/** The `.ProseMirror` element currently in the document, or null. */
export const pmEl = (): HTMLElement | null => document.querySelector<HTMLElement>(".ProseMirror");

/** The editor generation of `id` (bumped only by a wholesale replace). */
export const gen = (id: string): number =>
  useMilkdownEditorStore.getState().editorGenerations[id] ?? 0;

/** Remove exactly one trailing `\n`, if present. The only normalisation allowed. */
export const stripOneTrailingNewline = (s: string): string =>
  s.endsWith("\n") ? s.slice(0, -1) : s;

/** Focus the view, then put a collapsed caret at `pos` (history off). */
export function placeCaret(view: EditorView, pos: number): void {
  view.focus();
  const tr = view.state.tr
    .setSelection(TextSelection.create(view.state.doc, pos))
    .setMeta("addToHistory", false);
  view.dispatch(tr);
}

/** True when `document.activeElement` is the live view's `view.dom` or inside it. */
export function focusInLiveView(): boolean {
  const active = document.activeElement;
  const instance = liveEditor();
  if (!active || !instance) return false;
  return viewOf(instance).dom.contains(active);
}

export interface TypeResult {
  outcome: "typed" | "lost";
  flush: FlushResult;
}

/**
 * Simulate a keystroke `c` (F4 focus gate). Dispatches `insertText(c)` at the live
 * view's current selection only if focus is inside that view; otherwise dispatches
 * nothing. Either way it then runs `flushPendingEdits("save")` so the store is current.
 */
export async function typeAtFocus(c: string): Promise<TypeResult> {
  let outcome: TypeResult["outcome"] = "lost";
  let flush: FlushResult | undefined;
  await act(async () => {
    if (focusInLiveView()) {
      const view = liveView();
      view.dispatch(view.state.tr.insertText(c));
      outcome = "typed";
    }
    flush = useMilkdownEditorStore.getState().flushPendingEdits("save");
  });
  return { outcome, flush: flush! };
}

/**
 * Emit `name` with `payload` through the listener the REAL `useMcpEvents` registered on
 * the fake bus. Renders the hook first if nothing is listening for `name` yet.
 */
export async function emitMcp(bus: EventBus, name: string, payload: unknown): Promise<void> {
  if (!bus.has(name)) {
    renderHook(() => useMcpEvents());
    await act(async () => {});
  }
  const handler = bus.get(name);
  expect(handler, `no ${name} listener registered by useMcpEvents`).toBeTypeOf("function");
  await act(async () => {
    handler!({ payload });
  });
}

interface LogEntry {
  level?: string;
  event: string;
  status?: string;
  context?: Record<string, unknown>;
}

/** The recorded `editor.milkdown.focus.restore` entries from a `logEventSync` spy. */
export function restoreLogs(spy: Mock): LogEntry[] {
  return spy.mock.calls.map((call) => call[0] as LogEntry).filter((e) => e.event === RESTORE_EVENT);
}

// ---------------------------------------------------------------------------
// WI-4 additions (guards + restore suites). Existing lines above stay unchanged.
// ---------------------------------------------------------------------------

/** The outcomes of the recorded `focus.restore` lines, in order. */
export const restoreOutcomes = (spy: Mock): unknown[] =>
  restoreLogs(spy).map((e) => e.context?.outcome);

/** How many recorded `focus.restore` lines have `outcome`. */
export const countOutcome = (spy: Mock, outcome: string): number =>
  restoreOutcomes(spy).filter((o) => o === outcome).length;

/**
 * Emit several MCP events inside ONE `act`, so React renders nothing in between (G-3).
 * Renders `useMcpEvents` first if a listener is missing.
 */
export async function emitMcpInOneAct(
  bus: EventBus,
  events: Array<[name: string, payload: unknown]>,
  extra?: () => void,
): Promise<void> {
  if (events.some(([name]) => !bus.has(name))) {
    renderHook(() => useMcpEvents());
    await act(async () => {});
  }
  await act(async () => {
    for (const [name, payload] of events) bus.get(name)!({ payload });
    extra?.();
  });
}

/** The fake `getCurrentWebviewWindow().listen` bus (a set of callbacks per event). */
export type WebviewBus = Map<string, Set<(event: { payload: unknown }) => void>>;

/** Deliver `mcp:confirm_request` to every listener `useMcpConfirm` registered. */
export async function emitConfirmRequest(bus: WebviewBus, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.get("mcp:confirm_request") ?? [])]) cb({ payload });
    await Promise.resolve();
  });
}

let gateSetter: ((open: boolean) => void) | null = null;

/** Renders `children` only while open (G-3b, G-3c, G-10); drive it with `setGate`. */
export function Gate({ children }: { children: ReactNode }): ReactElement | null {
  const [open, setOpen] = useState(true);
  gateSetter = setOpen;
  return open ? createElement(Fragment, null, children) : null;
}

/** Open or close the mounted `Gate`. Call inside `act`. */
export function setGate(open: boolean): void {
  if (!gateSetter) throw new Error("setGate: no Gate is mounted");
  gateSetter(open);
}

/**
 * The transactions a `vi.spyOn(EditorView.prototype, "dispatch")` spy saw dispatched to
 * the CURRENT live view that requested a scroll ("Every restore scrolls").
 */
export function liveScrollDispatches(spy: Mock): Transaction[] {
  const view = liveView();
  return spy.mock.calls
    .map((call, i) => ({ tr: call[0] as Transaction, self: spy.mock.contexts[i] }))
    .filter(({ tr, self }) => self === view && tr.scrolledIntoView)
    .map(({ tr }) => tr);
}

/** Wait until a `.ProseMirror` other than `oldPm` shows `text` and an editor is live. */
export async function waitForNewPm(oldPm: HTMLElement | null, text: string): Promise<void> {
  await waitFor(
    () => {
      const el = pmEl();
      expect(el).not.toBeNull();
      expect(el).not.toBe(oldPm);
      expect(el!.textContent).toContain(text);
      expect(liveEditor()).not.toBeNull();
    },
    { timeout: 3000 },
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}
