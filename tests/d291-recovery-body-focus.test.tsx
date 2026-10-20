/** D291: Recovery closes from body onto the current editor without losing a keystroke. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState as ProseState } from "@milkdown/kit/prose/state";
import { EditorView as ProseView } from "@milkdown/kit/prose/view";
import { history as proseHistory, undoDepth as proseUndoDepth } from "@milkdown/kit/prose/history";
import { EditorSelection, EditorState as CmState } from "@codemirror/state";
import { EditorView as CmView } from "@codemirror/view";
import { history as cmHistory, undoDepth as cmUndoDepth } from "@codemirror/commands";
import type { Editor as MilkdownInstance } from "@milkdown/kit/core";

const { logs } = vi.hoisted(() => ({ logs: [] as Array<{ event: string; status: string; context?: Record<string, unknown> }> }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (command: string, args?: { payload?: typeof logs[number] }) => {
    if (command === "log_event" && args?.payload) logs.push(args.payload);
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", listen: async () => () => {} }),
}));

import { RecoveryDialog } from "../src/components/common/RecoveryDialog";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { makeDoc, mountAndWait, viewOf } from "./helpers/milkdownEditorHarness";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { readyMilkdown } from "../src/utils/focusActiveEditor";

const oneDraft = { id: "draft-a", title: "Draft", originalPath: null, lastModified: 1, size: 5 };
const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", toDOM: () => ["p", 0] }, text: {} },
});
const rangeMethods = ["getClientRects", "getBoundingClientRect"] as const;
const missingRangeMethods = rangeMethods.filter((name) => typeof Range.prototype[name] !== "function");
let mountedMilkdown: { instance: MilkdownInstance; unmount: () => void } | null = null;

function Recovery({ onResolve }: { onResolve?: () => void }) {
  const [drafts, setDrafts] = useState([oneDraft]);
  const resolve = () => { onResolve?.(); setDrafts([]); };
  // @ts-expect-error Focus fixture uses only the fields rendered by RecoveryDialog.
  return <RecoveryDialog drafts={drafts} onRecover={resolve} onDiscard={resolve} />;
}

function mountProse(text = "Hello") {
  const host = document.createElement("div");
  document.body.append(host);
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text(text)])]);
  let view: ProseView;
  view = new ProseView(host, {
    state: ProseState.create({ doc, plugins: [proseHistory()] }),
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      if (tr.docChanged) useDocumentStore.getState().updateDocumentContent("a", view.state.doc.textContent);
    },
  });
  const editor = { action: (fn: (ctx: { get: () => ProseView }) => unknown) => fn({ get: () => view }) };
  useMilkdownEditorStore.getState().registerEditor(() => editor);
  return view;
}

function mountSource(text = "Hello", anchor = 2, head = anchor) {
  const view = new CmView({
    state: CmState.create({
      doc: text,
      selection: EditorSelection.range(anchor, head),
      extensions: [cmHistory(), CmView.updateListener.of((update) => {
        if (update.docChanged) useDocumentStore.getState().updateDocumentContent("a", update.state.doc.toString());
      })],
    }),
    parent: document.body,
  });
  useEditorStore.getState().setEditorView(view);
  return view;
}

beforeEach(() => {
  installIntersectionObserverDouble();
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
  for (const name of missingRangeMethods) {
    Object.defineProperty(Range.prototype, name, {
      configurable: true,
      value: name === "getClientRects" ? () => [] : () => new DOMRect(0, 0, 0, 0),
    });
  }
  useDocumentStore.setState({ documents: [makeDoc("a", "Hello")], activeDocumentId: "a" });
  useEditorStore.setState({ viewMode: "wysiwyg", editorView: null });
  useMilkdownEditorStore.getState().unregisterEditor();
});

afterEach(() => {
  mountedMilkdown?.unmount();
  mountedMilkdown = null;
  useMilkdownEditorStore.getState().unregisterEditor();
  useEditorStore.setState({ editorView: null });
  document.body.innerHTML = "";
  for (const name of missingRangeMethods) delete (Range.prototype as unknown as Record<string, unknown>)[name];
});

describe("D291 Recovery body focus", () => {
  it("WYSIWYG: last row returns focus; first typed character edits only the active document", async () => {
    const user = userEvent.setup();
    const view = mountProse();
    expect(document.activeElement).toBe(document.body);
    render(<Recovery />);
    expect(proseUndoDepth(view.state)).toBe(0);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(view.dom).toHaveFocus();
    expect(view.state.doc.textContent).toBe("Hello");
    expect(proseUndoDepth(view.state)).toBe(0);
    await user.keyboard("q");
    expect(view.state.doc.textContent).toBe("Helloq");
    expect(useDocumentStore.getState().documents[0].content).toBe("Helloq");
  });

  it.each([[2, 2, "Heqllo"], [1, 4, "Hqo"], [4, 1, "Hqo"]])(
    "Source: first key uses live selection %i→%i",
    async (anchor, head, expected) => {
      const user = userEvent.setup();
      useEditorStore.setState({ viewMode: "source" });
      const view = mountSource("Hello", anchor, head);
      const before = view.state.selection;
      expect(document.activeElement).toBe(document.body);
      render(<Recovery />);
      await user.click(screen.getByRole("button", { name: "Discard" }));
      expect(view.hasFocus).toBe(true);
      expect(view.state.selection.eq(before)).toBe(true);
      expect(view.state.doc.toString()).toBe("Hello");
      expect(cmUndoDepth(view.state)).toBe(0);
      await user.keyboard("q");
      expect(view.state.doc.toString()).toBe(expected);
      expect(useDocumentStore.getState().documents[0].content).toBe(expected);
      view.destroy();
    },
  );

  it("waits for the current Source editor and applies focus only once", async () => {
    const user = userEvent.setup();
    useEditorStore.setState({ viewMode: "source" });
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    const view = mountSource();
    expect(view.hasFocus).toBe(true);
    await user.keyboard("q");
    expect(view.state.doc.toString()).toBe("Heqllo");
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    act(() => useEditorStore.getState().setEditorView(view));
    expect(outside).toHaveFocus();
    view.destroy();
  });

  it("cancels the waiting return after a document switch", async () => {
    const user = userEvent.setup();
    useEditorStore.setState({ viewMode: "source" });
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    act(() => {
      useDocumentStore.getState().upsertDocument(makeDoc("b", "Other"));
      useDocumentStore.getState().setActiveDocumentId("b");
    });
    const view = mountSource("Other");
    expect(view.hasFocus).toBe(false);
    expect(view.state.doc.toString()).toBe("Other");
    expect(logs.filter((entry) => entry.event === "ui.recovery.focus.cancel" && entry.context?.reason === "switched")).toHaveLength(1);
    view.destroy();
  });

  it("never revives a canceled return after switching A to B and back", async () => {
    const user = userEvent.setup();
    useEditorStore.setState({ viewMode: "source" });
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    act(() => {
      useDocumentStore.getState().upsertDocument(makeDoc("b", "Other"));
      useDocumentStore.getState().setActiveDocumentId("b");
      useDocumentStore.getState().setActiveDocumentId("a");
    });
    const view = mountSource();
    expect(view.hasFocus).toBe(false);
    expect(view.state.doc.toString()).toBe("Hello");
    const canceled = logs.filter((entry) => entry.event === "ui.recovery.focus.cancel");
    expect(canceled).toHaveLength(1);
    expect(canceled[0].status).toBe("cancel");
    expect(canceled[0].context).toEqual({ reason: "switched" });
    view.destroy();
  });

  it.each(["modal", "moved"] as const)("permanently cancels after transient %s focus", async (reason) => {
    const user = userEvent.setup();
    useEditorStore.setState({ viewMode: "source" });
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    const outside = document.createElement("button");
    document.body.append(outside);
    if (reason === "modal") {
      const modal = document.createElement("div");
      modal.setAttribute("aria-modal", "true");
      modal.append(outside);
      document.body.append(modal);
      outside.focus();
      modal.remove();
    } else {
      await user.click(outside);
      outside.remove();
    }
    const view = mountSource();
    expect(view.hasFocus).toBe(false);
    expect(view.state.doc.toString()).toBe("Hello");
    expect(logs.filter((entry) => entry.event === "ui.recovery.focus.cancel" && entry.context?.reason === reason)).toHaveLength(1);
    view.destroy();
  });

  it("waits for a real WYSIWYG view mounted after Recovery closes", async () => {
    const user = userEvent.setup();
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    mountedMilkdown = await mountAndWait(<MilkdownEditor />);
    const view = viewOf(mountedMilkdown.instance);
    expect(view.hasFocus()).toBe(true);
    await user.keyboard("q");
    expect(view.state.doc.textContent).toBe("Helloq");
  });

  it("rejects the outgoing generation after a same-document wholesale replacement", async () => {
    const user = userEvent.setup();
    mountedMilkdown = await mountAndWait(<MilkdownEditor />);
    const oldView = viewOf(mountedMilkdown.instance);
    oldView.dom.blur();
    render(<Recovery onResolve={() => useMilkdownEditorStore.getState().reloadEditor("a", "d291-test")} />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    let next: MilkdownInstance | null = null;
    await waitFor(() => {
      next = useMilkdownEditorStore.getState().getEditor() as MilkdownInstance | null;
      expect(next).not.toBe(mountedMilkdown!.instance);
      expect(next).not.toBeNull();
    });
    const currentView = viewOf(next!);
    await waitFor(() => expect(currentView.hasFocus()).toBe(true));
    expect(oldView.hasFocus()).toBe(false);
    await user.keyboard("q");
    expect(currentView.state.doc.textContent).toBe("Helloq");
    expect(oldView.state.doc.textContent).toBe("Hello");
    const selection = currentView.state.selection;
    const releaseStale = readyMilkdown("a", 0, oldView);
    expect(currentView.hasFocus()).toBe(true);
    expect(currentView.state.selection.eq(selection)).toBe(true);
    releaseStale();
    currentView.dom.blur();
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(currentView.hasFocus()).toBe(true);
  });

  it("tracks a newer generation while an editor is still loading", async () => {
    const user = userEvent.setup();
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    act(() => useMilkdownEditorStore.getState().reloadEditor("a", "d291-test"));
    mountedMilkdown = await mountAndWait(<MilkdownEditor />);
    expect(viewOf(mountedMilkdown.instance).hasFocus()).toBe(true);
  });

  it("does not consume B's return against A's outgoing editor during Recover", async () => {
    const user = userEvent.setup();
    mountedMilkdown = await mountAndWait(<MilkdownEditor />);
    const oldView = viewOf(mountedMilkdown.instance);
    oldView.dom.blur();
    render(<Recovery onResolve={() => {
      useDocumentStore.getState().upsertDocument(makeDoc("b", "Other"));
      useDocumentStore.getState().setActiveDocumentId("b");
    }} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    let next: MilkdownInstance | null = null;
    await waitFor(() => {
      next = useMilkdownEditorStore.getState().getEditor() as MilkdownInstance | null;
      expect(next).not.toBe(mountedMilkdown!.instance);
      expect(next).not.toBeNull();
    });
    const view = viewOf(next!);
    await waitFor(() => expect(view.hasFocus()).toBe(true));
    expect(oldView.hasFocus()).toBe(false);
    await user.keyboard("q");
    expect(view.state.doc.textContent).toBe("Otherq");
    expect(useDocumentStore.getState().documents.find((doc) => doc.id === "a")?.content).toBe("Hello");
  });
});
