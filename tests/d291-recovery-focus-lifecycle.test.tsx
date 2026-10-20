/** D291 fix round 1: the seven already-approved recovery focus matrix cases. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { TextSelection } from "@milkdown/kit/prose/state";
import { undoDepth as proseUndoDepth } from "@milkdown/kit/prose/history";
import { undoDepth as cmUndoDepth } from "@codemirror/commands";

const { logs, route } = vi.hoisted(() => ({
  logs: [] as Array<{ event: string; status: string; context?: Record<string, unknown> }>,
  route: { current: null as null | ((command: string, args?: { documentId?: string }) => unknown) },
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (command: string, args?: { payload?: typeof logs[number] }) => {
    if (command === "log_event" && args?.payload) logs.push(args.payload);
    // @ts-expect-error Routed IPC calls have command-specific argument shapes.
    if (route.current) return route.current(command, args);
    if (command === "recover_draft") return { content: "Other", originalPath: null, title: "Draft B" };
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", listen: async () => () => {} }),
}));

import { Recovery, recoveryDraft, installRangeGeometry, mountProse, mountSource, resetFocusStores } from "./support/d291FocusLifecycleFixture";
import { useDocument } from "../src/hooks/useDocument";
import { RecoveryDialog } from "../src/components/common/RecoveryDialog";
import { recoverDraft } from "../src/services/draftService";
import { draftRecoveryOutcome } from "../src/utils/draftRecoveryOutcome";
import { applyRecoveredDocument } from "../src/utils/recoverIntoOpenTab";
import { readyMilkdown, registerReadyEditor } from "../src/utils/focusActiveEditor";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { makeDoc } from "./helpers/milkdownEditorHarness";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { draft as placementDraft, RecoveryPlacementHarness } from "./support/d291RecoveryPlacementFixture";

const releases: Array<() => void> = [];
const views: Array<{ destroy: () => void }> = [];
let restoreGeometry = () => {};
const canceled = () => logs.filter((entry) => entry.event === "ui.recovery.focus.cancel");
const sourceReady = (id: string, view: ReturnType<typeof mountSource>) =>
  registerReadyEditor({
    documentId: id, generation: useMilkdownEditorStore.getState().editorGenerations[id] ?? 0,
    mode: "source", element: view.contentDOM,
    focus: () => { view.focus(); return view.contentDOM; },
  });

beforeEach(() => {
  installIntersectionObserverDouble();
  restoreGeometry = installRangeGeometry();
  logs.length = 0;
  route.current = null;
  useLoggingStore.setState({ enabled: true, level: "info" });
  resetFocusStores();
});
afterEach(() => {
  useDocumentStore.setState({ activeDocumentId: null });
  for (const release of releases.splice(0)) release();
  for (const view of views.splice(0)) view.destroy();
  useEditorStore.setState({ editorView: null });
  restoreGeometry();
  document.body.innerHTML = "";
});

describe("D291 fix round 1 matrix", () => {
  it("F-1 Source default selection and CJK: first key lands at offset zero", async () => {
    const user = userEvent.setup();
    resetFocusStores("你好世界", "source");
    const view = mountSource("你好世界"); views.push(view);
    releases.push(sourceReady("a", view));
    expect(view.state.selection.main.anchor).toBe(0);
    expect(view.state.selection.main.head).toBe(0);
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(view.hasFocus).toBe(true);
    await user.keyboard("文");
    expect(view.state.doc.toString()).toBe("文你好世界");
    expect(view.state.selection.main.anchor).toBe(1);
    expect(view.state.selection.main.head).toBe(1);
  });

  it("F-2 real Recover placement activates B and sends the first Source key only to B", async () => {
    const user = userEvent.setup();
    resetFocusStores("Hello", "source");
    const documentHook = renderHook(() => useDocument());
    const aView = mountSource("Hello", "a"); views.push(aView);
    releases.push(sourceReady("a", aView));
    const aFocus = vi.spyOn(aView, "focus");
    function PlacementCard() {
      const [rows, setRows] = useState([recoveryDraft]);
      const recover = async (id: string) => {
        const outcome = await recoverDraft(id);
        const mapped = draftRecoveryOutcome(id, { action: "recover", outcome });
        // App starts placement and removes the row without awaiting placement.
        if (mapped.upsert) void applyRecoveredDocument(id, mapped.upsert, {
          upsertAndActivate: documentHook.result.current.upsertAndActivateDocument,
          showToast: () => {},
        });
        if (mapped.dropRow) setRows([]);
      };
      return <RecoveryDialog drafts={rows} onRecover={recover} onDiscard={recover} />;
    }
    render(<PlacementCard />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    await waitFor(() => expect(useDocumentStore.getState().activeDocumentId).toBe("draft-b"));
    expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull();
    expect(document.body).toHaveFocus();
    expect(aView.hasFocus).toBe(false);
    expect(aFocus).not.toHaveBeenCalled();
    const bView = mountSource("Other", "draft-b"); views.push(bView);
    releases.push(sourceReady("draft-b", bView));
    await waitFor(() => expect(bView.hasFocus).toBe(true));
    await user.keyboard("q");
    expect(bView.state.doc.toString()).toBe("qOther");
    expect(useDocumentStore.getState().documents.find((doc) => doc.id === "draft-b")?.content).toBe("qOther");
    expect(useDocumentStore.getState().documents.find((doc) => doc.id === "a")?.content).toBe("Hello");
    expect(aFocus).not.toHaveBeenCalled();
  });

  it("F-3 duplicate current WYSIWYG readiness does not focus twice or move the caret", async () => {
    const user = userEvent.setup();
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    const view = mountProse("Hello"); views.push(view);
    const focus = vi.spyOn(view, "focus");
    releases.push(readyMilkdown("a", 0, view));
    expect(view.hasFocus()).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)).setMeta("addToHistory", false));
    const selection = view.state.selection;
    const outside = document.createElement("button"); document.body.append(outside); outside.focus();
    releases.push(readyMilkdown("a", 0, view));
    expect(outside).toHaveFocus();
    expect(view.state.selection.eq(selection)).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("F-4 switching A to B rejects A's late readiness with only one cancel", async () => {
    const user = userEvent.setup();
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    act(() => {
      useDocumentStore.getState().upsertDocument(makeDoc("b", "Other"));
      useDocumentStore.getState().setActiveDocumentId("b");
    });
    const oldView = mountProse("Hello"); views.push(oldView);
    releases.push(readyMilkdown("a", 0, oldView));
    expect(document.body).toHaveFocus();
    expect(oldView.hasFocus()).toBe(false);
    expect(oldView.state.doc.textContent).toBe("Hello");
    expect(canceled().map((entry) => entry.context)).toEqual([{ reason: "switched" }]);
  });

  it.each(["modal", "moved"] as const)("F-5 readiness while %s remains focused cancels once", async (reason) => {
    const user = userEvent.setup();
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    const outside = document.createElement("button");
    outside.textContent = "Elsewhere";
    if (reason === "modal") {
      const modal = document.createElement("div");
      modal.setAttribute("aria-modal", "true");
      modal.append(outside); document.body.append(modal);
    } else document.body.append(outside);
    await user.click(outside);
    const view = mountProse("Hello"); views.push(view);
    releases.push(readyMilkdown("a", 0, view));
    expect(outside).toHaveFocus();
    expect(view.hasFocus()).toBe(false);
    expect(view.state.doc.textContent).toBe("Hello");
    expect(canceled().map((entry) => entry.context)).toEqual([{ reason }]);
  });

  it("F-6 duplicate readiness after transient cancellation preserves body focus and selection", async () => {
    const user = userEvent.setup();
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    const outside = document.createElement("button"); document.body.append(outside);
    await user.click(outside); outside.remove();
    const view = mountProse("Hello"); views.push(view);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)).setMeta("addToHistory", false));
    const selection = view.state.selection;
    releases.push(readyMilkdown("a", 0, view));
    releases.push(readyMilkdown("a", 0, view));
    expect(document.body).toHaveFocus();
    expect(view.state.selection.eq(selection)).toBe(true);
    expect(view.state.doc.textContent).toBe("Hello");
    expect(canceled().map((entry) => entry.context)).toEqual([{ reason: "moved" }]);
  });

  it("F-7 WYSIWYG first key dirties the tab and adds exactly one undo step", async () => {
    const user = userEvent.setup();
    const view = mountProse("Hello"); views.push(view);
    releases.push(readyMilkdown("a", 0, view));
    const before = proseUndoDepth(view.state);
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(proseUndoDepth(view.state)).toBe(before);
    await user.keyboard("q");
    expect(view.state.doc.textContent).toBe("Helloq");
    expect(useDocumentStore.getState().documents[0].isModified).toBe(true);
    expect(proseUndoDepth(view.state)).toBe(before + 1);
  });

  it("F-7 Source first key dirties the tab and adds exactly one undo step", async () => {
    const user = userEvent.setup();
    resetFocusStores("Hello", "source");
    const view = mountSource("Hello", "a", { anchor: 1, head: 4 }); views.push(view);
    releases.push(sourceReady("a", view));
    const before = cmUndoDepth(view.state);
    render(<Recovery />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(cmUndoDepth(view.state)).toBe(before);
    await user.keyboard("q");
    expect(view.state.doc.toString()).toBe("Hqo");
    expect(useDocumentStore.getState().documents[0].isModified).toBe(true);
    expect(cmUndoDepth(view.state)).toBe(before + 1);
  });

  it.each(["B-last", "C-last"] as const)("D291-WI-5 overlapping recoveries %s focus the final committed destination", async (order) => {
    const user = userEvent.setup();
    const bCheck = (() => { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>((yes) => { resolve = yes; }); return { promise, resolve }; })();
    const cRecover = (() => { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>((yes) => { resolve = yes; }); return { promise, resolve }; })();
    let bCheckStarted = false;
    route.current = (command, args) => {
      if (command === "recover_draft" && args?.documentId === "draft-b") return { content: "Recovered B", originalPath: "/x/b.md", title: "B" };
      if (command === "recover_draft" && args?.documentId === "draft-c") return order === "C-last" ? cRecover.promise : { content: "Recovered C", originalPath: null, title: "C" };
      if (command === "get_draft") { bCheckStarted = true; return bCheck.promise; }
      if (command === "save_draft") return { success: true };
      return null;
    };
    resetFocusStores("Alpha", "source");
    useDocumentStore.setState({ documents: [makeDoc("a", "Alpha"), makeDoc("b", "Old B", "/x/b.md")], activeDocumentId: "a" });
    const aView = mountSource("Alpha", "a"); views.push(aView); releases.push(sourceReady("a", aView));
    render(<RecoveryPlacementHarness rows={[placementDraft("draft-b"), placementDraft("draft-c", null)]} />);
    const button = (id: string) => within(screen.getByText(id).closest(".recovery-item") as HTMLElement).getByRole("button", { name: "Recover" });
    await user.click(button("draft-b"));
    await waitFor(() => expect(bCheckStarted).toBe(true));
    const c = button("draft-c");
    expect(c.getAttribute("aria-disabled")).toBe("false");
    await user.click(c);
    if (order === "B-last") act(() => bCheck.resolve(null));
    else {
      act(() => bCheck.resolve(null));
      await waitFor(() => expect(useDocumentStore.getState().getDocumentById("b")?.content).toBe("Recovered B"));
      act(() => cRecover.resolve({ content: "Recovered C", originalPath: null, title: "C" }));
    }
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
    const finalId = order === "B-last" ? "b" : "draft-c";
    await waitFor(() => expect(useDocumentStore.getState().activeDocumentId).toBe(finalId));
    const finalView = mountSource(useDocumentStore.getState().getDocumentById(finalId)!.content, finalId); views.push(finalView);
    releases.push(sourceReady(finalId, finalView));
    await waitFor(() => expect(finalView.hasFocus).toBe(true));
    await user.keyboard("q");
    expect(useDocumentStore.getState().getDocumentById(finalId)?.content).toContain("q");
    expect(useDocumentStore.getState().getDocumentById("a")?.content).toBe("Alpha");
    expect(useDocumentStore.getState().getDocumentById("b")?.content).toContain("Recovered B");
    expect(useDocumentStore.getState().getDocumentById("draft-c")?.content).toContain("Recovered C");
  });
  it("D291-WI-5 cancellation stays final across duplicate destination readiness", async () => {
    const user = userEvent.setup();
    const check = (() => { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>((yes) => { resolve = yes; }); return { promise, resolve }; })();
    route.current = (command) => command === "recover_draft" ? { content: "Recovered B", originalPath: "/x/b.md", title: "B" }
      : command === "get_draft" ? check.promise : null;
    resetFocusStores("Alpha", "source");
    useDocumentStore.setState({ documents: [makeDoc("a", "Alpha"), makeDoc("b", "Old B", "/x/b.md")], activeDocumentId: "a" });
    const a = mountSource("Alpha", "a"); views.push(a); releases.push(sourceReady("a", a));
    render(<RecoveryPlacementHarness rows={[placementDraft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    const outside = document.createElement("button"); document.body.append(outside); await user.click(outside); outside.remove();
    act(() => check.resolve(null));
    await waitFor(() => expect(useDocumentStore.getState().getDocumentById("b")?.content).toBe("Recovered B"));
    const b = mountSource("Recovered B", "b"); views.push(b);
    const selection = b.state.selection; releases.push(sourceReady("b", b)); releases.push(sourceReady("b", b));
    await user.keyboard("q");
    expect(document.body).toHaveFocus(); expect(b.hasFocus).toBe(false);
    expect(b.state.selection.eq(selection)).toBe(true);
    expect(useDocumentStore.getState().getDocumentById("a")?.content).toBe("Alpha");
    expect(useDocumentStore.getState().getDocumentById("b")?.content).toBe("Recovered B");
    expect(canceled().map((entry) => entry.context)).toEqual([{ reason: "moved" }]);
  });
  it("D291-WI-5 failed recover keeps its row, toast and usable controls", async () => {
    const user = userEvent.setup();
    route.current = (command) => { if (command === "recover_draft") throw Error("backend unavailable"); return null; };
    render(<RecoveryPlacementHarness rows={[placementDraft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    expect(screen.getByRole("dialog", { name: "Recover drafts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recover" }).getAttribute("aria-disabled")).toBe("false");
    expect(screen.getByText("Failed to recover draft")).toBeInTheDocument();
  });
});
