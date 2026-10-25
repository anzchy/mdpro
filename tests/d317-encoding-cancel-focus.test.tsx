/**
 * D317-WI-1 — cancelling the Encoding dialog (Escape or Cancel) gives keyboard focus
 * back to the same live editor, with its selection, so the next typed key edits that
 * document (B4: focus stayed on the page root and a typed key edited nothing).
 *
 * Matrix: `~/.mdpro-redesign/herdr-spike/opus-imple-1/D317-test-matrix.md` § AC-1 (1.1–1.7),
 * r1 row 2.18 (the prior is used, not only the fallback) and r2 rows 1.1s / 1.3s (the DOM
 * selection is restored through the view, not left to a raw element focus) and 1.8 (synchronous).
 *
 * Mock boundaries: core `invoke` (`log_event` recorded). The editors are a real
 * ProseMirror view and a real CodeMirror view, registered the way the app does.
 * Typing goes through `userEvent.keyboard` on whatever holds focus, so an editor
 * that only *looks* focused (a wrapper, a stale view) does not take the key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type LogPayload = { event?: string; context?: Record<string, unknown> };
const { logs } = vi.hoisted(() => ({ logs: [] as LogPayload[] }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (cmd: string, args?: { payload?: LogPayload }) => {
    if (cmd === "log_event") logs.push(args?.payload ?? {});
    return Promise.resolve(null);
  },
}));

import { useLoggingStore } from "../src/stores/loggingStore";
import { useDocumentStore } from "../src/stores/documentStore";
import {
  activate, cmText, createEncodingParent, domSelectionIn, mountCm, mountPm, pmText,
  resetD317World, shimRangeLayout,
} from "./support/d317EditorFixtures";

const dialog = () => screen.queryByRole("dialog", { name: "Select encoding" });
const cancelButton = () => screen.getByRole("button", { name: "Cancel" });
const count = (event: string) => logs.filter((l) => l.event === event).length;

/** What a click on the card's text does to the window selection (round-2 Gap A). */
function moveDomSelectionOntoCard(): void {
  const text = dialog()!.querySelector("h3")!.firstChild!;
  act(() => window.getSelection()!.collapse(text, 0));
}

beforeEach(() => {
  shimRangeLayout();
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

afterEach(() => {
  resetD317World();
});

type Close = (user: ReturnType<typeof userEvent.setup>) => Promise<void>;
const CLOSES: Array<[string, Close]> = [
  ["Escape", async (user) => user.keyboard("{Escape}")],
  ["Cancel", async (user) => user.click(cancelButton())],
];

describe("D317-WI-1 WYSIWYG: cancel returns focus to the same ProseMirror view", () => {
  it.each(CLOSES)("1.1/1.2 %s with the editor focused at open keeps its selection and takes the next key", async (_n, close) => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    expect(cancelButton()).toHaveFocus();
    await close(user);
    expect(dialog()).toBeNull();
    expect(controls.cancels).toBe(1);
    expect(pm.view.dom).toHaveFocus();
    expect([pm.view.state.selection.from, pm.view.state.selection.to]).toEqual([3, 8]);
    expect(domSelectionIn(pm.view)).toEqual({ anchor: 3, head: 8 });
    await user.keyboard("x");
    expect(pmText(pm)).toBe("Hexorld");
  });

  it.each(CLOSES)("1.5 B4: opened from <body>, %s focuses the active editor without moving its caret", async (_n, close) => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    // B4: the tester clicked the dialog's text, so focus sat on the page root.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(document.activeElement).toBe(document.body);
    await close(user);
    expect(dialog()).toBeNull();
    expect(pm.view.dom).toHaveFocus();
    expect(pm.view.state.selection.from).toBe(3);
    expect(domSelectionIn(pm.view)).toEqual({ anchor: 3, head: 3 });
    await user.keyboard("x");
    expect(pmText(pm)).toBe("Hexllo world");
  });

  it("2.18 the element that held focus at open is used even with no ready registration", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    pm.release();
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    await user.keyboard("{Escape}");
    expect(pm.view.dom).toHaveFocus();
    expect(pm.view.state.selection.from).toBe(3);
  });
});

describe("D317-WI-1 Source: cancel returns focus to the same CodeMirror view", () => {
  it.each(CLOSES)("1.3/1.4 %s with the editor focused at open keeps its selection and takes the next key", async (_n, close) => {
    const user = userEvent.setup();
    activate("doc-1", "source");
    const cm = mountCm("doc-1", "Hello world", 2, 4);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => cm.view.focus());
    controls.open();
    await close(user);
    expect(dialog()).toBeNull();
    expect(cm.view.hasFocus).toBe(true);
    expect(cm.view.contentDOM).toHaveFocus();
    expect([cm.view.state.selection.main.from, cm.view.state.selection.main.to]).toEqual([2, 4]);
    expect(cm.view.contentDOM.contains(window.getSelection()?.anchorNode ?? null)).toBe(true);
    await user.keyboard("x");
    expect(cmText(cm)).toBe("Hexo world");
  });

  it.each(CLOSES)("1.6 B4: opened from <body>, %s focuses the active Source view at its caret", async (_n, close) => {
    const user = userEvent.setup();
    activate("doc-1", "source");
    const cm = mountCm("doc-1", "Hello world", 2);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await close(user);
    expect(cm.view.contentDOM).toHaveFocus();
    expect(cm.view.state.selection.main.head).toBe(2);
    await user.keyboard("x");
    expect(cmText(cm)).toBe("Hexllo world");
  });
});

describe("D317-WI-1 one cancel per press", () => {
  it("1.7 Escape cancels exactly once through the existing path", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    await user.keyboard("{Escape}");
    expect(controls.cancels).toBe(1);
    expect(count("ui.dialog.escape")).toBe(1);
    expect(logs.filter((l) => l.event === "ui.dialog.cancel").map((l) => l.context?.controlId)).toEqual(["dialog.encoding.cancel"]);
    expect(pm.view.dom).toHaveFocus();
  });
});

describe("D317-WI-1 the selection comes back through the view, not a raw element focus", () => {
  it("1.1s WYSIWYG: the DOM selection had moved onto the card; Esc restores 3..8 in the DOM", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    moveDomSelectionOntoCard();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" });
    expect(dialog()).toBeNull();
    expect(pm.view.dom).toHaveFocus();
    expect(domSelectionIn(pm.view)).toEqual({ anchor: 3, head: 8 });
    await user.keyboard("x");
    expect(pmText(pm)).toBe("Hexorld");
  });

  it("1.3s Source: the DOM selection had moved onto the card; Esc puts it back in the content", async () => {
    const user = userEvent.setup();
    activate("doc-1", "source");
    const cm = mountCm("doc-1", "Hello world", 2, 4);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => cm.view.focus());
    controls.open();
    moveDomSelectionOntoCard();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" });
    expect(cm.view.contentDOM).toHaveFocus();
    expect(cm.view.contentDOM.contains(window.getSelection()?.anchorNode ?? null)).toBe(true);
    expect([cm.view.state.selection.main.anchor, cm.view.state.selection.main.head]).toEqual([2, 4]);
    await user.keyboard("x");
    expect(cmText(cm)).toBe("Hexo world");
  });

  it("1.8 the return is synchronous with the close (no timer, no frame)", () => {
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" }); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(pm.view.dom);
  });
});
