/** D291-WI-4: Recovery return follows the committed placement, never outgoing A. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { readyMilkdown, registerReadyEditor } from "../src/utils/focusActiveEditor";
import { makeDoc } from "./helpers/milkdownEditorHarness";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { installRangeGeometry, mountProse, mountSource, resetFocusStores } from "./support/d291FocusLifecycleFixture";
import { draft, RecoveryPlacementHarness } from "./support/d291RecoveryPlacementFixture";

type Payload = { event: string; status: string; context?: Record<string, unknown> };
const io = vi.hoisted(() => ({ calls: [] as Array<{ command: string; args: unknown }>,
  logs: [] as Payload[], route: vi.fn() }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (command: string, args?: { payload?: Payload }) => {
    if (command === "log_event" && args?.payload) io.logs.push(args.payload);
    else io.calls.push({ command, args });
    return command === "log_event" ? Promise.resolve(null) : io.route(command, args);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", listen: async () => () => {} }),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const releases: Array<() => void> = [];
const views: Array<{ destroy: () => void }> = [];
let restoreGeometry = () => {};
const doc = (id: string) => useDocumentStore.getState().getDocumentById(id);
const cancelLogs = () => io.logs.filter((entry) => entry.event === "ui.recovery.focus.cancel");
const active = () => useDocumentStore.getState().activeDocumentId;
const dialog = () => screen.queryByRole("dialog", { name: "Recover drafts" });
const readySource = (id: string, view: ReturnType<typeof mountSource>) =>
  registerReadyEditor({ documentId: id, generation: useMilkdownEditorStore.getState().editorGenerations[id] ?? 0,
    mode: "source", element: view.contentDOM,
    focus: () => { view.focus(); return view.contentDOM; } });

function sourceA() {
  const view = mountSource("Alpha", "a"); views.push(view);
  releases.push(readySource("a", view));
  return view;
}
function sourceFor(id: string, text: string) {
  const view = mountSource(text, id); views.push(view);
  releases.push(readySource(id, view));
  return view;
}
function setupMatched() {
  resetFocusStores("Alpha", "source");
  useDocumentStore.setState({ documents: [makeDoc("a", "Alpha"), makeDoc("b", "Old B", "/x/b.md")], activeDocumentId: "a" });
  return sourceA();
}
function routeRecover(path: string | null = "/x/b.md", text = "Recovered B", check?: ReturnType<typeof deferred<unknown>>) {
  io.route.mockImplementation((command: string) => {
    if (command === "recover_draft") return Promise.resolve({ content: text, originalPath: path, title: "Draft" });
    if (command === "get_draft") return check?.promise ?? Promise.resolve(null);
    if (command === "save_draft") return Promise.resolve({ success: true });
    if (command === "delete_draft" || command === "discard_recovery_draft") return Promise.resolve(true);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  installIntersectionObserverDouble(); restoreGeometry = installRangeGeometry();
  io.calls.length = 0; io.logs.length = 0; io.route.mockReset();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useToastStore.getState().clearToast();
  resetFocusStores("Alpha", "source");
});
afterEach(() => {
  useDocumentStore.setState({ activeDocumentId: null });
  for (const release of releases.splice(0)) release();
  for (const view of views.splice(0)) view.destroy();
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {}, editorGenerations: {} });
  useEditorStore.setState({ editorView: null });
  useToastStore.getState().clearToast(); restoreGeometry(); document.body.innerHTML = "";
});

describe("D291 placement-bound focus", () => {
  it("G-1 held clean match: no key edits A; after B commits the first key edits B", async () => {
    const user = userEvent.setup(); const check = deferred<unknown>();
    const aView = setupMatched(); routeRecover("/x/b.md", "Recovered B", check);
    const aFocus = vi.spyOn(aView, "focus");
    render(<RecoveryPlacementHarness rows={[draft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    await waitFor(() => expect(io.calls.some((call) => call.command === "get_draft")).toBe(true));
    await user.keyboard("q");
    expect(aView.hasFocus).toBe(false);
    expect(aFocus).not.toHaveBeenCalled();
    expect(doc("a")?.content).toBe("Alpha");
    act(() => check.resolve(null));
    await waitFor(() => expect(active()).toBe("b"));
    const bView = sourceFor("b", "Recovered B");
    await waitFor(() => expect(bView.hasFocus).toBe(true));
    await user.keyboard("q");
    expect(doc("b")?.content).toBe("qRecovered B");
    expect(doc("a")?.content).toBe("Alpha");
  });
  it("G-2 no match: new draft tab receives the first key", async () => {
    const user = userEvent.setup(); setupMatched(); routeRecover(null, "New text");
    render(<RecoveryPlacementHarness rows={[draft("draft-new", null)]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    await waitFor(() => expect(active()).toBe("draft-new"));
    const view = sourceFor("draft-new", "New text");
    await waitFor(() => expect(view.hasFocus).toBe(true));
    await user.keyboard("q");
    expect(doc("draft-new")?.content).toBe("qNew text");
    expect(doc("a")?.content).toBe("Alpha");
    expect(io.calls.filter((call) => call.command === "get_draft")).toHaveLength(0);
  });
  it.each([
    ["present", { id: "other-draft" }, "Another unsaved draft"],
    ["check-failed", new Error("unreadable"), "Could not check"],
  ] as const)("G-2 %s check: collision tab, unchanged B and existing toast", async (kind, result, toastText) => {
    const user = userEvent.setup(); const check = deferred<unknown>();
    setupMatched(); routeRecover("/x/b.md", "Recovered B", check);
    render(<RecoveryPlacementHarness rows={[draft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    await waitFor(() => expect(io.calls.some((call) => call.command === "get_draft")).toBe(true));
    act(() => kind === "present" ? check.resolve(result) : check.reject(result));
    await waitFor(() => expect(active()).toBe("draft-b"));
    const view = sourceFor("draft-b", "Recovered B");
    await waitFor(() => expect(view.hasFocus).toBe(true));
    await user.keyboard("q");
    expect(doc("draft-b")?.content).toBe("qRecovered B");
    expect(doc("b")?.content).toBe("Old B");
    expect(doc("a")?.content).toBe("Alpha");
    expect(useToastStore.getState().message).toContain(toastText);
    expect(io.calls.filter((call) => call.command === "delete_draft")).toHaveLength(0);
  });
  it("G-2 B becomes dirty during the check: draft gets focus; B keeps its text", async () => {
    const user = userEvent.setup(); const check = deferred<unknown>();
    setupMatched(); routeRecover("/x/b.md", "Recovered B", check);
    render(<RecoveryPlacementHarness rows={[draft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    await waitFor(() => expect(io.calls.some((call) => call.command === "get_draft")).toBe(true));
    act(() => useDocumentStore.getState().updateDocumentContent("b", "local B"));
    act(() => check.resolve(null));
    await waitFor(() => expect(active()).toBe("draft-b"));
    const view = sourceFor("draft-b", "Recovered B");
    await waitFor(() => expect(view.hasFocus).toBe(true));
    await user.keyboard("q");
    expect(doc("a")?.content).toBe("Alpha");
    expect(doc("b")?.content).toBe("local B");
    expect(doc("draft-b")?.content).toBe("qRecovered B");
    expect(useToastStore.getState().message).toContain("recovered draft and an unsaved edit");
  });
  it("G-2 clean merge returns focus before re-key save completes and deletes afterward", async () => {
    const user = userEvent.setup(); const check = deferred<unknown>(); const save = deferred<unknown>();
    setupMatched(); routeRecover("/x/b.md", "Recovered B", check);
    const baseRoute = io.route.getMockImplementation()!;
    io.route.mockImplementation((command: string, args: unknown) => command === "save_draft" ? save.promise : baseRoute(command, args));
    render(<RecoveryPlacementHarness rows={[draft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    act(() => check.resolve(null));
    await waitFor(() => expect(active()).toBe("b"));
    const view = sourceFor("b", "Recovered B");
    await waitFor(() => expect(view.hasFocus).toBe(true));
    expect(dialog()).toBeNull();
    expect(doc("b")?.isModified).toBe(true);
    expect(io.calls.filter((call) => call.command === "delete_draft")).toHaveLength(0);
    act(() => save.resolve({ success: true }));
    await waitFor(() => expect(io.calls.filter((call) => call.command === "delete_draft")).toHaveLength(1));
    expect(io.calls.filter((call) => ["save_draft", "delete_draft"].includes(call.command)).map((call) => call.command))
      .toEqual(["save_draft", "delete_draft"]);
  });
  it.each(["moved", "switched", "modal"] as const)("G-2 %s during held placement cancels return once", async (reason) => {
    const user = userEvent.setup(); const check = deferred<unknown>();
    const a = setupMatched(); routeRecover("/x/b.md", "Recovered B", check);
    render(<RecoveryPlacementHarness rows={[draft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    await waitFor(() => expect(io.calls.some((call) => call.command === "get_draft")).toBe(true));
    const outside = document.createElement("button"); outside.textContent = "Outside";
    if (reason === "modal") { const modal = document.createElement("div"); modal.setAttribute("aria-modal", "true"); modal.append(outside); document.body.append(modal); }
    else document.body.append(outside);
    if (reason === "switched") act(() => { useDocumentStore.getState().upsertDocument(makeDoc("c", "Other C")); useDocumentStore.getState().setActiveDocumentId("c"); });
    else await user.click(outside);
    act(() => check.resolve(null));
    await waitFor(() => expect(doc("b")?.content).toBe("Recovered B"));
    expect(a.hasFocus).toBe(false);
    expect(doc("a")?.content).toBe("Alpha");
    expect(cancelLogs().map((entry) => entry.context)).toEqual([{ reason }]);
  });
  it("G-2 cancellation during the first recover_draft await stays cancelled", async () => {
    const user = userEvent.setup(); const recover = deferred<unknown>();
    setupMatched(); routeRecover(); const baseRoute = io.route.getMockImplementation()!;
    io.route.mockImplementation((command: string, args: unknown) => command === "recover_draft" ? recover.promise : baseRoute(command, args));
    render(<RecoveryPlacementHarness rows={[draft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    const outside = document.createElement("button"); document.body.append(outside);
    await user.click(outside); outside.remove();
    act(() => recover.resolve({ content: "Recovered B", originalPath: "/x/b.md", title: "Draft" }));
    await waitFor(() => expect(doc("b")?.content).toBe("Recovered B"));
    expect(document.body).toHaveFocus();
    expect(doc("a")?.content).toBe("Alpha");
    expect(cancelLogs().map((entry) => entry.context)).toEqual([{ reason: "moved" }]);
  });
  it.each(["Recover", "Discard"] as const)("G-2 competing %s on a pending row cannot focus A", async (action) => {
    const user = userEvent.setup(); const check = deferred<unknown>();
    const a = setupMatched(); routeRecover("/x/b.md", "Recovered B", check);
    render(<RecoveryPlacementHarness rows={[draft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    await waitFor(() => expect(io.calls.some((call) => call.command === "get_draft")).toBe(true));
    const competing = screen.queryByRole("button", { name: action });
    if (competing && !competing.hasAttribute("aria-disabled")) await user.click(competing);
    await user.keyboard("q");
    expect(a.hasFocus).toBe(false);
    expect(doc("a")?.content).toBe("Alpha");
    act(() => check.resolve(null));
    await waitFor(() => expect(doc("b")?.content).toBe("Recovered B"));
    expect(io.calls.filter((call) => call.command === "recover_draft")).toHaveLength(1);
  });
  it("G-2 a second row is not silently dropped while B is pending", async () => {
    const user = userEvent.setup(); const check = deferred<unknown>();
    setupMatched(); routeRecover(); const baseRoute = io.route.getMockImplementation()!;
    io.route.mockImplementation((command: string, args: { documentId?: string }) =>
      command === "recover_draft" && args?.documentId === "draft-c"
        ? Promise.resolve({ content: "Recovered C", originalPath: null, title: "C" }) : baseRoute(command, args));
    render(<RecoveryPlacementHarness rows={[draft("draft-b"), draft("draft-c", null)]} />);
    const rowButton = (id: string) => within(screen.getByText(id).closest(".recovery-item") as HTMLElement).getByRole("button", { name: "Recover" });
    await user.click(rowButton("draft-b"));
    await waitFor(() => expect(io.calls.some((call) => call.command === "get_draft")).toBe(true));
    const c = rowButton("draft-c");
    if (!c.hasAttribute("aria-disabled")) await user.click(c);
    act(() => check.resolve(null));
    await waitFor(() => expect(doc("b")?.content).toBe("Recovered B"));
    if (c.hasAttribute("aria-disabled")) await user.click(rowButton("draft-c"));
    await waitFor(() => expect(doc("draft-c")?.content).toBe("Recovered C"));
    expect(doc("a")?.content).toBe("Alpha");
    expect(dialog()).toBeNull();
    const finalView = sourceFor(active()!, doc(active()!)!.content);
    await waitFor(() => expect(finalView.hasFocus).toBe(true));
  });
  it("G-2 stale B generation cannot consume the committed return", async () => {
    const user = userEvent.setup(); const check = deferred<unknown>();
    setupMatched(); routeRecover("/x/b.md", "Recovered B", check);
    render(<RecoveryPlacementHarness rows={[draft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    act(() => check.resolve(null)); await waitFor(() => expect(active()).toBe("b"));
    act(() => useMilkdownEditorStore.getState().reloadEditor("b", "d291-test"));
    const view = mountSource("Recovered B", "b"); views.push(view);
    releases.push(registerReadyEditor({ documentId: "b", generation: 0, mode: "source", element: view.contentDOM, focus: () => { view.focus(); return view.contentDOM; } }));
    expect(view.hasFocus).toBe(false);
    releases.push(readySource("b", view));
    await waitFor(() => expect(view.hasFocus).toBe(true));
    await user.keyboard("q"); expect(doc("b")?.content).toBe("qRecovered B"); expect(doc("a")?.content).toBe("Alpha");
  });
  it("G-2 activation refusal never substitutes outgoing A as destination", async () => {
    const user = userEvent.setup(); const check = deferred<unknown>();
    resetFocusStores("Alpha", "wysiwyg");
    useDocumentStore.setState({ documents: [makeDoc("a", "Alpha"), makeDoc("b", "Old B", "/x/b.md")], activeDocumentId: "a" });
    const a = mountProse("Alpha"); views.push(a); releases.push(readyMilkdown("a", 0, a));
    releases.push(useMilkdownEditorStore.getState().registerFlusher("a", () => ({ status: "failed" })));
    routeRecover("/x/b.md", "Recovered B", check);
    render(<RecoveryPlacementHarness rows={[draft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    act(() => check.resolve(null)); await waitFor(() => expect(doc("b")?.content).toBe("Recovered B"));
    expect(active()).toBe("a"); expect(a.hasFocus()).toBe(false);
    expect(doc("a")?.content).toBe("Alpha");
    await user.keyboard("q"); expect(doc("a")?.content).toBe("Alpha"); expect(doc("b")?.content).toBe("Recovered B");
    expect(cancelLogs().map((entry) => entry.context)).toEqual([{ reason: "activation" }]);
    expect(useToastStore.getState().message).toContain("could not be captured");
  });
  it("G-2 throw before placement commit drops row, reports failure, and cancels focus", async () => {
    const user = userEvent.setup(); const check = deferred<unknown>();
    const a = setupMatched(); routeRecover("/x/b.md", "Recovered B", check);
    const failures: string[] = [];
    const unlisten = useToastStore.subscribe((state) => { if (state.message === "Failed to recover draft") failures.push(state.message); });
    releases.push(useMilkdownEditorStore.getState().registerFlusher("b", () => ({ status: "clean" }), () => { throw Error("boom"); }));
    render(<RecoveryPlacementHarness rows={[draft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Recover" }));
    act(() => check.resolve(null)); await waitFor(() => expect(dialog()).toBeNull());
    expect(a.hasFocus).toBe(false); expect(doc("a")?.content).toBe("Alpha");
    await user.keyboard("q"); expect(doc("a")?.content).toBe("Alpha");
    expect(useToastStore.getState().message).toBe("Failed to recover draft");
    expect(failures).toHaveLength(1); unlisten();
    expect(cancelLogs().map((entry) => entry.context)).toEqual([{ reason: "placement" }]);
  });
  it("G-3 Discard still closes the last row; failed recover keeps it and its toast", async () => {
    const user = userEvent.setup(); setupMatched(); routeRecover();
    render(<RecoveryPlacementHarness rows={[draft("draft-b")]} />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(dialog()).toBeNull(); expect(doc("a")?.content).toBe("Alpha");
  });
});
