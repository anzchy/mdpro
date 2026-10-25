/**
 * D317-WI-2 — the Encoding cancel's focus return on the other cancel path (backdrop)
 * and across lifecycles: a pending retry stays aborted; focus that moved is left
 * alone; a replaced, closed or other-document view is never focused; a covered
 * editor under another modal is never focused; a success or an external clear changes
 * no focus; and the capture is made per opening, not on first mount.
 *
 * Matrix: `~/.mdpro-redesign/herdr-spike/opus-imple-1/D317-test-matrix.md` § AC-2
 * (2.1–2.15), Amendment r1 (2.16, 2.17, 2.19–2.23, 2.13′) and r2 (2.24, the held MCP prompt).
 *
 * Mock boundaries: `@tauri-apps/api/{core,event,window,webviewWindow}`. `open_file`
 * is answered by the test (first call: the encoding error; later calls wait).
 * Editors are real ProseMirror and CodeMirror views; `AppDialogs` and its dialogs
 * are real.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type LogPayload = { event?: string; context?: Record<string, unknown> };
type Cb = (event: { payload: unknown }) => void;
const { logs, bus, openFile } = vi.hoisted(() => ({
  logs: [] as LogPayload[],
  bus: { window: new Map() as Map<string, Set<(event: { payload: unknown }) => void>> },
  openFile: { impl: null as null | (() => Promise<unknown>) },
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (cmd: string, args?: { payload?: LogPayload }) => {
    if (cmd === "log_event") logs.push(args?.payload ?? {});
    if (cmd === "open_file" && openFile.impl) return openFile.impl();
    return Promise.resolve(null);
  },
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: async (name: string, cb: Cb) => {
      const set = bus.window.get(name) ?? new Set<Cb>();
      set.add(cb);
      bus.window.set(name, set);
      return () => void set.delete(cb);
    },
  })),
}));

import { EncodingDialog } from "../src/components/common/EncodingDialog";
import { supersedeRetry, useDocument } from "../src/hooks/useDocument";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { registerReadyEditor } from "../src/utils/focusActiveEditor";
import { createAppDialogsHarness, dialogFor } from "./support/appDialogsHarness";
import {
  activate, cmText, createEncodingParent, mountCm, mountPm, otherModal, outsideButton, pmText,
  resetD317World, shimRangeLayout,
} from "./support/d317EditorFixtures";

const dialog = () => screen.queryByRole("dialog", { name: "Select encoding" });
const cancelButton = () => screen.getByRole("button", { name: "Cancel" });
const blurToBody = () => act(() => (document.activeElement as HTMLElement | null)?.blur());

beforeEach(() => {
  shimRangeLayout();
  logs.length = 0;
  bus.window.clear();
  openFile.impl = null;
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useMilkdownEditorStore.setState({ editorGenerations: {} });
});

afterEach(() => {
  resetD317World();
});

describe("D317-WI-2 backdrop cancel", () => {
  it("2.1 a backdrop click with the editor focused at open returns focus and selection", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    await user.click(dialog()!.parentElement!);
    expect(dialog()).toBeNull();
    expect(controls.cancels).toBe(1);
    expect(pm.view.dom).toHaveFocus();
    expect([pm.view.state.selection.from, pm.view.state.selection.to]).toEqual([3, 8]);
  });

  it("2.2 a backdrop click from <body> (B4) focuses the active editor at its caret", async () => {
    const user = userEvent.setup();
    activate("doc-1", "source");
    const cm = mountCm("doc-1", "Hello world", 2);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    blurToBody();
    await user.click(dialog()!.parentElement!);
    expect(cm.view.contentDOM).toHaveFocus();
    expect(cm.view.state.selection.main.head).toBe(2);
  });
});

describe("D317-WI-2 a pending retry stays aborted", () => {
  it("2.3 Escape during a pending UTF-16 retry aborts it, commits nothing and returns focus", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    useDocumentStore.setState({ documents: [{ id: "doc-1", path: "/x/doc-1.md", content: "", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null }] });
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    const pending: Array<(v: unknown) => void> = [];
    let first = true;
    openFile.impl = () => {
      if (first) { first = false; return Promise.reject({ EncodingError: { path: "/x/gb.md", detected: "unknown" } }); }
      return new Promise((r) => pending.push(r));
    };
    const outcomes: unknown[] = [];
    let signal: AbortSignal | null = null;
    const hook = renderHook(() => useDocument());
    await act(async () => { await hook.result.current.openPathOutcome("/x/gb.md"); });
    // App's handlers (App.tsx handleEncodingSelect / handleEncodingCancel), around the real dialog.
    function RetryParent() {
      const retryRef = useRef<AbortController | null>(null);
      const { encodingIssue, openDocumentWithEncoding, clearEncodingIssue } = hook.result.current;
      return (
        <EncodingDialog
          open={Boolean(encodingIssue)}
          path={encodingIssue?.path ?? ""}
          onSelect={(encoding) => {
            signal = supersedeRetry(retryRef);
            void openDocumentWithEncoding("/x/gb.md", encoding, undefined, signal).then((o) => outcomes.push(o));
          }}
          onCancel={() => { retryRef.current?.abort(); clearEncodingIssue(); }}
        />
      );
    }
    const before = structuredClone(useDocumentStore.getState().documents);
    const view = render(<RetryParent />);
    act(() => pm.view.focus());
    view.rerender(<RetryParent />);
    expect(dialog()).not.toBeNull();
    await user.click(screen.getByRole("button", { name: /UTF-16LE/ }));
    expect(pending).toHaveLength(1);
    await user.keyboard("{Escape}");
    hook.rerender();
    view.rerender(<RetryParent />);
    expect(dialog()).toBeNull();
    expect(signal!.aborted).toBe(true);
    await act(async () => { pending[0]({ document: { id: "doc-gb", path: "/x/gb.md", content: "LATE", encoding: "UTF-16LE", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null } }); await Promise.resolve(); await Promise.resolve(); });
    expect(outcomes).toEqual([{ kind: "cancelled" }]);
    expect(useDocumentStore.getState().documents).toEqual(before);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-1");
    expect(pm.view.dom).toHaveFocus();
    expect([pm.view.state.selection.from, pm.view.state.selection.to]).toEqual([3, 8]);
    hook.unmount();
  });
});

describe("D317-WI-2 focus that moved, and which target counts", () => {
  it("2.4 focus moved to another live control while open (programmatic: a find bar, MCP) stays there", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    const elsewhere = outsideButton();
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    act(() => elsewhere.focus());
    await user.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(elsewhere).toHaveFocus();
  });

  it("2.17 opened from a live non-editor control, the cancel returns there, not to the editor", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    const row = outsideButton("Sidebar row");
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => row.focus());
    controls.open();
    await user.keyboard("{Escape}");
    expect(row).toHaveFocus();
    expect(pm.view.dom).not.toHaveFocus();
  });

  it("2.16 the capture is per opening: a second opening from a button returns to that button", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    const row = outsideButton("Sidebar row");
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    await user.click(cancelButton());
    expect(pm.view.dom).toHaveFocus();
    act(() => row.focus());
    controls.open();
    await user.keyboard("{Escape}");
    expect(row).toHaveFocus();
  });

  it("2.14 reopened from <body> after a switch, the cancel targets the new active document's view", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm1 = mountPm("doc-1", "One", 1);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    blurToBody();
    await user.keyboard("{Escape}");
    expect(pm1.view.dom).toHaveFocus();
    pm1.destroy();
    activate("doc-2", "wysiwyg");
    const pm2 = mountPm("doc-2", "Two words", 2);
    blurToBody();
    controls.open();
    blurToBody();
    await user.keyboard("{Escape}");
    expect(pm2.view.dom).toHaveFocus();
    expect(pm2.view.state.selection.from).toBe(2);
  });
});

describe("D317-WI-2 replaced, closed, switched and absent editors", () => {
  it("2.5 the view was rebuilt for the same document: the new view takes focus at its own selection", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const a = mountPm("doc-1", "Old text", 3, 5);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => a.view.focus());
    controls.open();
    a.destroy();
    useMilkdownEditorStore.setState({ editorGenerations: { "doc-1": 1 } });
    const b = mountPm("doc-1", "Fresh text", 2);
    await user.keyboard("{Escape}");
    expect(b.view.dom).toHaveFocus();
    expect(b.view.state.selection.from).toBe(2);
    expect(a.view.dom.isConnected).toBe(false);
  });

  it("2.6 the active document changed while open: the reused Source view is not focused", async () => {
    // The Source EditorView is one instance re-registered per document (Editor.tsx);
    // a switch with a modal open comes only from an external open or MCP (D165).
    const user = userEvent.setup();
    activate("doc-1", "source");
    const cm = mountCm("doc-1", "Hello world", 2, 4);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => cm.view.focus());
    controls.open();
    cm.release();
    activate("doc-2", "source");
    registerReadyEditor({
      documentId: "doc-2", generation: 0, mode: "source", element: cm.view.contentDOM,
      focus: () => { cm.view.focus(); return cm.view.contentDOM; },
    });
    await user.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(cm.view.hasFocus).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it("2.7 the view closed while open: nothing detached is focused and nothing throws", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    pm.destroy();
    await user.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("2.8 no active document: closing invents no editor target", async () => {
    const user = userEvent.setup();
    activate(null, "wysiwyg");
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    blurToBody();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(document.body);
  });

  it("2.9 no active document but a stale editor still registered: it is not focused", async () => {
    const user = userEvent.setup();
    activate("old", "wysiwyg");
    const pm = mountPm("old", "Stale", 2);
    activate(null, "wysiwyg");
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    blurToBody();
    await user.keyboard("{Escape}");
    expect(pm.view.dom).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it("2.15 the mode switched while open (from <body>): the live Source view is focused, not the hidden one", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    blurToBody();
    pm.release();
    activate("doc-1", "source");
    const cm = mountCm("doc-1", "Hello world", 5);
    await user.keyboard("{Escape}");
    expect(cm.view.contentDOM).toHaveFocus();
    expect(pm.view.dom).not.toHaveFocus();
  });

  it("2.19 the mode switched while open (from the WYSIWYG view): the key goes into the Source document", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    pm.release();
    activate("doc-1", "source");
    const cm = mountCm("doc-1", "Hello world", 5);
    await user.keyboard("{Escape}");
    expect(cm.view.contentDOM).toHaveFocus();
    await user.keyboard("x");
    expect(cmText(cm)).toBe("Hellox world");
    expect(pmText(pm)).toBe("Hello world");
  });
});

describe("D317-WI-2 another modal owns the screen", () => {
  it("2.10 opened from <body> over another modal: the covered editor is not focused", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const other = otherModal();
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    blurToBody();
    await user.click(cancelButton());
    expect(dialog()).toBeNull();
    expect(pm.view.dom).not.toHaveFocus();
    expect(other.card.isConnected).toBe(true);
  });

  it("2.11 opened from the editor, but another modal opened beneath meanwhile: the editor is not focused", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const other = otherModal();
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    await user.click(cancelButton());
    expect(pm.view.dom).not.toHaveFocus();
    other.remove();
  });

  it("2.22 opened from a button inside a beneath modal: that button gets focus back", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    mountPm("doc-1", "Hello world", 3);
    const other = otherModal();
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => other.button.focus());
    controls.open();
    await user.click(cancelButton());
    expect(other.button).toHaveFocus();
  });

  function mountAppDialogs() {
    const fx = JSON.parse(readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8")) as {
      events: { request: string; resolved: string }; samples: Array<Record<string, unknown>>;
    };
    const deliver = async (name: string, payload: unknown) => {
      await act(async () => { for (const cb of [...(bus.window.get(name) ?? [])]) cb({ payload }); await Promise.resolve(); });
    };
    const h = createAppDialogsHarness({ deliver, events: fx.events, request: (id, title) => ({ ...fx.samples[0], requestId: id, documentTitle: title }) });
    render(<h.Harness />);
    return h;
  }

  it("2.20 real AppDialogs: Encoding over an open Reload, from <body>: Escape leaves Reload up and the editor unfocused", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const h = mountAppDialogs();
    await act(async () => { await Promise.resolve(); });
    await h.open("reload");
    blurToBody();
    await h.open("encoding");
    blurToBody();
    await user.keyboard("{Escape}");
    expect(dialogFor("encoding")).toBeNull();
    expect(dialogFor("reload")).not.toBeNull();
    expect(pm.view.dom).not.toHaveFocus();
  });

  it("2.21 real AppDialogs: a Reload stacked over Encoding and closed first does not block the later return", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    const h = mountAppDialogs();
    await act(async () => { await Promise.resolve(); });
    act(() => pm.view.focus());
    await h.open("encoding");
    await h.open("reload");
    await h.close("reload");
    await user.keyboard("{Escape}");
    expect(dialogFor("encoding")).toBeNull();
    expect(pm.view.dom).toHaveFocus();
    expect([pm.view.state.selection.from, pm.view.state.selection.to]).toEqual([3, 8]);
  });

  it("2.24 real AppDialogs: a held MCP prompt that shows after the cancel keeps focus; rejecting it returns to the editor", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3, 8);
    const h = mountAppDialogs();
    await act(async () => { await Promise.resolve(); });
    act(() => pm.view.focus());
    await h.open("encoding");
    await h.open("mcp");
    expect(dialogFor("mcp")).toBeNull(); // D240: held while Encoding is open
    await user.keyboard("{Escape}");
    await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(dialogFor("encoding")).toBeNull();
    const mcp = dialogFor("mcp");
    expect(mcp).not.toBeNull();
    expect(mcp!.contains(document.activeElement)).toBe(true);
    expect(pm.view.dom).not.toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(dialogFor("mcp")).toBeNull();
    expect(pm.view.dom).toHaveFocus();
    expect([pm.view.state.selection.from, pm.view.state.selection.to]).toEqual([3, 8]);
  });
});

describe("D317-WI-2 closes that are not a cancel change no focus", () => {
  it("2.12 a retry choice from <body> leaves focus where the close put it", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    blurToBody();
    await user.click(screen.getByRole("button", { name: /UTF-16LE/ }));
    expect(controls.selects).toEqual(["UTF-16LE"]);
    expect(dialog()).toBeNull();
    expect(pm.view.dom).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it("2.23 a successful retry that activated another document never focuses the old view", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const focusSpy = vi.spyOn(pm.view, "focus");
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    focusSpy.mockClear();
    controls.open();
    activate("doc-gb", "wysiwyg");
    await user.click(screen.getByRole("button", { name: /UTF-16LE/ }));
    expect(pm.view.dom).not.toHaveFocus();
    expect(focusSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("2.13′ an external clear (App clears the issue) changes no focus", () => {
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const focusSpy = vi.spyOn(pm.view, "focus");
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    focusSpy.mockClear();
    controls.open();
    controls.clear();
    expect(dialog()).toBeNull();
    expect(focusSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });
});

// Keep the shared store shape referenced so a rename breaks this file loudly.
void useEditorStore;
