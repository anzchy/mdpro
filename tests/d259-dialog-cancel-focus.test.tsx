/**
 * D259-WI-1 — Insert link and Insert table give keyboard focus back when they
 * close (rules 32 and 33), instead of leaving it on `<body>`.
 *
 * Laws:
 * 1. Every close (Escape, Cancel, a backdrop click, a successful Insert)
 *    returns focus to what held it when the dialog opened, with the editor's
 *    selection unchanged.
 * 2. When that element is gone, focus goes to the active editor's end (the
 *    D73 stale clear after a document switch included); opened from `<body>`,
 *    nothing is focused; focus already moved elsewhere is left alone.
 * 3. A failed table Insert keeps the dialog open and focus inside it.
 * 4. The cancel and submit log lines say whether focus was returned
 *    (`focusReturned`), so a device run can tell the path was reached.
 *
 * Mock boundaries: core `invoke` (`log_event` recorded). The editors are a
 * real ProseMirror view, registered in the real `milkdownEditorStore` behind a
 * minimal stand-in for Milkdown's `editor.action`, and a real CodeMirror view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { EditorState as CmState } from "@codemirror/state";
import { EditorView as CmView } from "@codemirror/view";

type LogPayload = { event?: string; context?: Record<string, unknown> };
const { logs } = vi.hoisted(() => ({ logs: [] as LogPayload[] }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (cmd: string, args?: { payload?: LogPayload }) => {
    if (cmd === "log_event") logs.push(args?.payload ?? {});
    return Promise.resolve(null);
  },
}));

import { LinkInsertModal } from "../src/components/Editor/LinkInsertModal";
import { TableInsertModal } from "../src/components/Editor/TableInsertModal";
import { insertLinkCommand } from "../src/plugins/codemirror/linkPlugin";
import { useLinkInsertStore } from "../src/stores/linkInsertStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTableInsertStore } from "../src/stores/tableInsertStore";

const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", toDOM: () => ["p", 0] }, text: {} },
});

/** A real ProseMirror view with the caret at 3, registered as the active editor. */
function mountEditor(text = "Hello world"): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text(text)])]);
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });
  const view = new EditorView(host, { state });
  const editor = { action: (fn: (ctx: { get: () => EditorView }) => unknown) => fn({ get: () => view }) };
  useMilkdownEditorStore.getState().registerEditor(() => editor);
  return view;
}

function outsideButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Outside";
  document.body.appendChild(button);
  return button;
}

const lastLog = (event: string) => [...logs].reverse().find((l) => l.event === event);
// By label: a CodeMirror view in the document is a "textbox" too (L9).
const urlField = () => screen.getByLabelText("URL");
const linkDialog = () => screen.queryByRole("dialog", { name: "Insert link" });
const tableDialog = () => screen.queryByRole("dialog", { name: /Insert Table/ });

// jsdom has no Range layout; ProseMirror measures the restored selection after focus returns.
const RANGE_LAYOUT = ["getClientRects", "getBoundingClientRect"] as const;
let rangeShimmed: string[] = [];

async function openLink(cb: (url: string) => void = () => {}) {
  act(() => useLinkInsertStore.getState().setPendingCallback(cb));
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

async function openTable(cb: (rows: number, cols: number) => boolean = () => true) {
  act(() => useTableInsertStore.getState().requestInsert(cb));
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

beforeEach(() => {
  const proto = Range.prototype as unknown as Record<string, unknown>;
  rangeShimmed = RANGE_LAYOUT.filter((name) => typeof proto[name] !== "function");
  for (const name of rangeShimmed) {
    proto[name] = name === "getClientRects" ? () => [] : () => new DOMRect(0, 0, 0, 0);
  }
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
  useLinkInsertStore.setState({ pendingCallback: null, mode: "wysiwyg" });
  useTableInsertStore.setState({ pendingCallback: null });
});

afterEach(() => {
  act(() => {
    useLinkInsertStore.setState({ pendingCallback: null });
    useTableInsertStore.setState({ pendingCallback: null });
  });
  useMilkdownEditorStore.getState().unregisterEditor();
  document.body.innerHTML = "";
  const proto = Range.prototype as unknown as Record<string, unknown>;
  for (const name of rangeShimmed) delete proto[name];
});

describe("D259-WI-1 Insert link returns focus on close", () => {
  it.each([
    ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
    ["Cancel", async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Cancel" }))],
    ["a backdrop click", async (user: ReturnType<typeof userEvent.setup>) => user.click(linkDialog()!.parentElement!)],
  ])("L1 %s returns focus to the editor with its selection unchanged", async (_name, close) => {
    const user = userEvent.setup();
    const view = mountEditor();
    render(<LinkInsertModal />);
    act(() => view.focus());
    await openLink();
    await user.click(urlField());
    await close(user);
    expect(linkDialog()).toBeNull();
    expect(view.dom).toHaveFocus();
    expect(view.state.selection.from).toBe(3);
    expect(lastLog("ui.link-modal.cancel")?.context?.focusReturned).toBe(true);
  });

  it("L2 a successful Insert returns focus to the editor and logs it", async () => {
    const user = userEvent.setup();
    const view = mountEditor();
    const applied: string[] = [];
    render(<LinkInsertModal />);
    act(() => view.focus());
    await openLink((url) => applied.push(url));
    await user.type(urlField(), "example.com");
    await user.click(screen.getByRole("button", { name: "Insert" }));
    expect(applied).toEqual(["example.com"]);
    expect(linkDialog()).toBeNull();
    expect(view.dom).toHaveFocus();
    expect(lastLog("ui.link-modal.submit")?.context?.focusReturned).toBe(true);
  });

  it("L3 when the editor that had focus is gone, focus goes to the active editor's end", async () => {
    const user = userEvent.setup();
    const old = mountEditor("Old");
    render(<LinkInsertModal />);
    act(() => old.focus());
    await openLink();
    await user.click(urlField());
    old.destroy();
    old.dom.parentElement?.remove();
    const fresh = mountEditor("Fresh text");
    await user.keyboard("{Escape}");
    expect(fresh.dom).toHaveFocus();
    expect(fresh.state.selection.from).toBe(fresh.state.doc.content.size - 1);
  });

  it("L4 D73's stale clear while the same editor survives returns focus to it", async () => {
    const user = userEvent.setup();
    const view = mountEditor();
    render(<LinkInsertModal />);
    act(() => view.focus());
    await openLink();
    await user.click(urlField());
    act(() => useLinkInsertStore.getState().clearPendingCallback());
    expect(linkDialog()).toBeNull();
    expect(view.dom).toHaveFocus();
  });

  it("L5 D73's stale clear after a document switch (old view gone) falls back to the new editor's end", async () => {
    const user = userEvent.setup();
    const old = mountEditor("Old");
    render(<LinkInsertModal />);
    act(() => old.focus());
    await openLink();
    await user.click(urlField());
    old.destroy();
    old.dom.parentElement?.remove();
    const fresh = mountEditor("Other document");
    act(() => useLinkInsertStore.getState().clearPendingCallback());
    expect(fresh.dom).toHaveFocus();
    expect(fresh.state.selection.from).toBe(fresh.state.doc.content.size - 1);
  });

  it("L6 opened from <body>, closing focuses nothing and logs focusReturned false", async () => {
    const user = userEvent.setup();
    mountEditor();
    render(<LinkInsertModal />);
    await openLink();
    await user.click(urlField());
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(document.body);
    expect(lastLog("ui.link-modal.cancel")?.context?.focusReturned).toBe(false);
  });

  it("L7 focus that moved outside the dialog before it closed is left there", async () => {
    const view = mountEditor();
    const outside = outsideButton();
    render(<LinkInsertModal />);
    act(() => view.focus());
    await openLink();
    act(() => outside.focus());
    act(() => useLinkInsertStore.getState().clearPendingCallback());
    expect(outside).toHaveFocus();
  });

  it("L8 a reopened dialog captures afresh: the second close returns to the second opener", async () => {
    const user = userEvent.setup();
    const view = mountEditor();
    const outside = outsideButton();
    render(<LinkInsertModal />);
    act(() => view.focus());
    await openLink();
    await user.keyboard("{Escape}");
    expect(view.dom).toHaveFocus();
    act(() => outside.focus());
    await openLink();
    await user.click(urlField());
    await user.keyboard("{Escape}");
    expect(outside).toHaveFocus();
  });

  it("L9 Source mode: Cancel leaves focus in the CodeMirror view", async () => {
    const user = userEvent.setup();
    const cm = new CmView({ state: CmState.create({ doc: "some text" }), parent: document.body });
    render(<LinkInsertModal />);
    act(() => cm.focus());
    act(() => void insertLinkCommand(cm));
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    await user.click(urlField());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cm.hasFocus).toBe(true);
    expect(lastLog("ui.link-modal.cancel")?.context?.focusReturned).toBe(true);
    cm.destroy();
  });
});

describe("D259-WI-1 Insert table returns focus on close", () => {
  it.each([
    ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
    ["Cancel", async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Cancel" }))],
    ["a backdrop click", async (user: ReturnType<typeof userEvent.setup>) => user.click(tableDialog()!.parentElement!)],
  ])("T1 %s returns focus to the editor with its selection unchanged", async (_name, close) => {
    const user = userEvent.setup();
    const view = mountEditor();
    render(<TableInsertModal />);
    act(() => view.focus());
    await openTable();
    await user.click(screen.getByRole("spinbutton", { name: "Rows" }));
    await close(user);
    expect(tableDialog()).toBeNull();
    expect(view.dom).toHaveFocus();
    expect(view.state.selection.from).toBe(3);
    expect(lastLog("ui.table-modal.cancel")?.context?.focusReturned).toBe(true);
  });

  it("T2 a successful Insert returns focus to the editor and logs it", async () => {
    const user = userEvent.setup();
    const view = mountEditor();
    render(<TableInsertModal />);
    act(() => view.focus());
    await openTable(() => true);
    await user.click(screen.getByRole("button", { name: "Insert" }));
    expect(tableDialog()).toBeNull();
    expect(view.dom).toHaveFocus();
    expect(lastLog("ui.table-modal.submit")?.context?.focusReturned).toBe(true);
  });

  it("T3 a failed Insert keeps the dialog open with focus inside it", async () => {
    const user = userEvent.setup();
    const view = mountEditor();
    render(<TableInsertModal />);
    act(() => view.focus());
    await openTable(() => false);
    const insert = screen.getByRole("button", { name: "Insert" });
    await user.click(insert);
    expect(tableDialog()).not.toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(tableDialog()!.contains(document.activeElement)).toBe(true);
    expect(lastLog("ui.table-modal.submit")?.context?.focusReturned).toBe(false);
  });

  it("T4 opened from <body>, closing focuses nothing and logs focusReturned false", async () => {
    const user = userEvent.setup();
    mountEditor();
    render(<TableInsertModal />);
    await openTable();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(document.body);
    expect(lastLog("ui.table-modal.cancel")?.context?.focusReturned).toBe(false);
  });
});
