/** M3b: real editor views behind the D261 window-scoped menu listener. */
import { createElement } from "react";
import { act } from "@testing-library/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLinkInsertStore } from "../src/stores/linkInsertStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTableInsertStore } from "../src/stores/tableInsertStore";
import { LinkInsertModal } from "../src/components/Editor/LinkInsertModal";
import { TableInsertModal } from "../src/components/Editor/TableInsertModal";
import { bus, logs, win } from "./support/menuEventsHarness";
import { flush, mountHook, resetMenuHarness } from "./support/menuEventsDomain";
import { seedStores } from "./support/editorGenerationDomain";
import { mountMilkdownMenuRig, mountSourceMenuRig, type MilkdownMenuRig, type SourceMenuRig } from "./support/editorMenuRig";

const EVENT = "menu:action";
let milkdown: MilkdownMenuRig | null = null;
let source: SourceMenuRig | null = null;
let unregister: (() => void) | null = null;

beforeEach(() => {
  resetMenuHarness();
  seedStores();
  useEditorStore.setState({ viewMode: "wysiwyg" });
  useLinkInsertStore.setState({ pendingCallback: null, mode: "wysiwyg" });
});

afterEach(async () => {
  unregister?.();
  unregister = null;
  source?.destroy();
  source = null;
  await milkdown?.destroy();
  milkdown = null;
  useLinkInsertStore.getState().clearPendingCallback();
  useTableInsertStore.getState().clearPending();
});

async function setupEditors() {
  milkdown = await mountMilkdownMenuRig("alpha");
  source = mountSourceMenuRig("alpha");
  unregister = useMilkdownEditorStore.getState().registerEditor(() => milkdown?.editor ?? null);
  useEditorStore.getState().setEditorView(source.view);
}

const selectLines = () => logs.filter(({ payload }) => payload.event === "ui.menu.select");

it("AC-1: addressed W and S heading clicks edit once; a wrong window never does", async () => {
  await setupEditors();
  win.label = "A";
  const a = mountHook({});
  win.label = "B";
  const b = mountHook({});
  await flush();
  expect(bus.count(EVENT)).toBe(2);

  useEditorStore.setState({ viewMode: "wysiwyg" });
  bus.emitTo("B", EVENT, { action: "editor.paragraph.heading2", target: "B" });
  await flush();
  expect(milkdown!.view.state.doc.firstChild?.type.name).toBe("heading");
  expect(milkdown!.view.state.doc.firstChild?.attrs.level).toBe(2);
  expect(selectLines().filter(({ payload }) => payload.status === "success")).toHaveLength(1);

  useEditorStore.setState({ viewMode: "source" });
  bus.emitTo("B", EVENT, { action: "editor.paragraph.heading2", target: "B" });
  await flush();
  expect(source!.view.state.doc.toString()).toBe("## alpha");
  expect(selectLines().filter(({ payload }) => payload.status === "success")).toHaveLength(2);
  a.unmount();
  b.unmount();
});

it("AC-2: a modal or Settings recorder focus refuses a menu editor write once", async () => {
  await setupEditors();
  win.label = "main";
  const hook = mountHook({});
  await flush();
  const modal = document.body.appendChild(document.createElement("div"));
  modal.setAttribute("aria-modal", "true");
  const recorder = modal.appendChild(document.createElement("button"));
  recorder.setAttribute("data-shortcut-recorder", "true");
  recorder.focus();
  bus.emitTo("main", EVENT, { action: "editor.paragraph.heading2", target: "main" });
  await flush();
  expect(milkdown!.view.state.doc.firstChild?.type.name).toBe("paragraph");
  expect(selectLines().filter(({ payload }) => payload.status === "cancel")).toHaveLength(1);
  modal.remove();
  hook.unmount();
});

it("AC-2: a deferred link submitted after switch-away-and-back is stale", async () => {
  await setupEditors();
  const hook = mountHook({});
  await flush();
  bus.emitTo("main", EVENT, { action: "editor.format.hyperlink", target: "main" });
  await flush();
  const apply = useLinkInsertStore.getState().pendingCallback;
  expect(apply).not.toBeNull();
  useDocumentStore.getState().setActiveDocument("d2");
  useDocumentStore.getState().setActiveDocument("d1");
  await act(async () => apply?.("https://example.com"));
  expect(milkdown!.view.state.doc.textContent).toBe("alpha");
  expect(selectLines().filter(({ payload }) => payload.status === "cancel" && payload.context?.reason === "stale")).toHaveLength(1);
  hook.unmount();
});

it("AC-5: one menu link request shares the modal and never applies twice", async () => {
  await setupEditors();
  const hook = mountHook({});
  await flush();
  bus.emitTo("main", EVENT, { action: "editor.format.hyperlink", target: "main" });
  await flush();
  const first = useLinkInsertStore.getState().pendingCallback;
  expect(first).not.toBeNull();
  bus.emitTo("main", EVENT, { action: "editor.format.hyperlink", target: "main" });
  await flush();
  expect(useLinkInsertStore.getState().pendingCallback).toBe(first);
  hook.unmount();
});

it("AC-1: wrong-target delivery changes no editor and creates no success log", async () => {
  await setupEditors();
  win.label = "A";
  const a = mountHook({});
  await flush();
  bus.emitAny(EVENT, { action: "editor.paragraph.heading2", target: "B" });
  await flush();
  expect(milkdown!.view.state.doc.firstChild?.type.name).toBe("paragraph");
  expect(selectLines().filter(({ payload }) => payload.status === "success")).toHaveLength(0);
  expect(selectLines().filter(({ payload }) => payload.context?.reason === "wrong_target")).toHaveLength(1);
  a.unmount();
});

it("AC-2: mode switch and editor remount both stale a pending W link", async () => {
  await setupEditors();
  const hook = mountHook({});
  await flush();
  bus.emitTo("main", EVENT, { action: "editor.format.hyperlink", target: "main" });
  await flush();
  const old = useLinkInsertStore.getState().pendingCallback;
  expect(old).not.toBeNull();
  useEditorStore.setState({ viewMode: "source" });
  await act(async () => old?.("https://example.com"));
  expect(milkdown!.view.state.doc.firstChild?.firstChild?.marks).toHaveLength(0);

  useEditorStore.setState({ viewMode: "wysiwyg" });
  useLinkInsertStore.getState().clearPendingCallback();
  bus.emitTo("main", EVENT, { action: "editor.format.hyperlink", target: "main" });
  await flush();
  const beforeRemount = useLinkInsertStore.getState().pendingCallback;
  expect(beforeRemount).not.toBeNull();
  unregister?.();
  unregister = useMilkdownEditorStore.getState().registerEditor(() => milkdown?.editor ?? null);
  await act(async () => beforeRemount?.("https://example.com"));
  expect(milkdown!.view.state.doc.firstChild?.firstChild?.marks).toHaveLength(0);
  expect(selectLines().filter(({ payload }) => payload.context?.reason === "stale")).toHaveLength(2);
  hook.unmount();
});

it("AC-5: W menu link blocks dangerous URLs and normalizes a bare host", async () => {
  await setupEditors();
  const view = milkdown!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  const hook = mountHook({});
  await flush();
  bus.emitTo("main", EVENT, { action: "editor.format.hyperlink", target: "main" });
  await flush();
  useLinkInsertStore.getState().pendingCallback?.("javascript:alert(1)");
  expect(view.state.doc.firstChild?.firstChild?.marks.some((mark) => mark.type.name === "link")).toBe(false);
  expect(selectLines().filter(({ payload }) => payload.context?.reason === "unsafe_url")).toHaveLength(1);
  expect(JSON.stringify(selectLines())).not.toContain("javascript:alert");
  useLinkInsertStore.getState().clearPendingCallback();
  bus.emitTo("main", EVENT, { action: "editor.format.hyperlink", target: "main" });
  await flush();
  useLinkInsertStore.getState().pendingCallback?.("example.com");
  const link = view.state.doc.firstChild?.firstChild?.marks.find((mark) => mark.type.name === "link");
  expect(link?.attrs.href).toBe("https://example.com");
  hook.unmount();
});

it("AC-5: Source link submit after switch-away-and-back changes nothing", async () => {
  await setupEditors();
  useEditorStore.setState({ viewMode: "source" });
  const hook = mountHook({});
  await flush();
  bus.emitTo("main", EVENT, { action: "editor.format.hyperlink", target: "main" });
  await flush();
  const apply = useLinkInsertStore.getState().pendingCallback;
  expect(apply).not.toBeNull();
  useDocumentStore.getState().setActiveDocument("d2");
  useDocumentStore.getState().setActiveDocument("d1");
  await act(async () => apply?.("https://example.com"));
  expect(source!.view.state.doc.toString()).toBe("alpha");
  expect(selectLines().filter(({ payload }) => payload.context?.reason === "stale")).toHaveLength(1);
  hook.unmount();
});

it("AC-5: Source menu link rejects an unsafe URL without leaking it to logs", async () => {
  await setupEditors();
  useEditorStore.setState({ viewMode: "source" });
  const hook = mountHook({});
  await flush();
  bus.emitTo("main", EVENT, { action: "editor.format.hyperlink", target: "main" });
  await flush();
  useLinkInsertStore.getState().pendingCallback?.("data:text/html,SECRET");
  expect(source!.view.state.doc.toString()).toBe("alpha");
  expect(selectLines().filter(({ payload }) => payload.context?.reason === "unsafe_url")).toHaveLength(1);
  expect(JSON.stringify(selectLines())).not.toContain("SECRET");
  hook.unmount();
});

it("AC-5: menu link Cancel and Escape close without a mark", async () => {
  await setupEditors();
  const hook = mountHook({});
  render(createElement(LinkInsertModal));
  await flush();
  bus.emitTo("main", EVENT, { action: "editor.format.hyperlink", target: "main" });
  await flush();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(useLinkInsertStore.getState().pendingCallback).toBeNull();
  expect(milkdown!.view.state.doc.firstChild?.firstChild?.marks).toHaveLength(0);
  bus.emitTo("main", EVENT, { action: "editor.format.hyperlink", target: "main" });
  await flush();
  screen.getByRole("textbox", { name: "URL" }).focus();
  await userEvent.keyboard("{Escape}");
  expect(useLinkInsertStore.getState().pendingCallback).toBeNull();
  expect(milkdown!.view.state.doc.firstChild?.firstChild?.marks).toHaveLength(0);
  hook.unmount();
});

it("AC-3: W paragraph indent and table action outside a table refuse", async () => {
  await setupEditors();
  const hook = mountHook({});
  await flush();
  const before = milkdown!.view.state.doc;
  bus.emitTo("main", EVENT, { action: "editor.paragraph.indent", target: "main" });
  bus.emitTo("main", EVENT, { action: "editor.table.insertRowAbove", target: "main" });
  await flush();
  expect(milkdown!.view.state.doc.eq(before)).toBe(true);
  expect(selectLines().filter(({ payload }) => payload.status === "cancel")).toHaveLength(2);
  hook.unmount();
});

it("AC-2: a menu Table dialog submitted after a mode switch inserts nothing", async () => {
  await setupEditors();
  const hook = mountHook({});
  await flush();
  bus.emitTo("main", EVENT, { action: "editor.paragraph.table", target: "main" });
  await flush();
  const submit = useTableInsertStore.getState().pendingCallback;
  expect(submit).not.toBeNull();
  useEditorStore.setState({ viewMode: "source" });
  await act(async () => submit?.(2, 2));
  expect(milkdown!.view.state.doc.firstChild?.type.name).toBe("paragraph");
  expect(selectLines().filter(({ payload }) => payload.context?.reason === "stale")).toHaveLength(1);
  hook.unmount();
});
it("F1: failed in-table insert stays open; retry outside inserts and closes", async () => {
  milkdown = await mountMilkdownMenuRig("| A | B |\n| --- | --- |\n| x | y |\n\noutside");
  unregister = useMilkdownEditorStore.getState().registerEditor(() => milkdown?.editor ?? null);
  const view = milkdown.view;
  let cell = -1;
  view.state.doc.descendants((node, pos) => { if (cell < 0 && node.type.name === "table_cell") cell = pos; });
  expect(cell).toBeGreaterThanOrEqual(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(cell + 2))));
  const before = view.state.doc;
  const hook = mountHook({});
  render(createElement(TableInsertModal));
  await flush();
  bus.emitTo("main", EVENT, { action: "editor.paragraph.table", target: "main" });
  await flush();
  await userEvent.click(screen.getByRole("button", { name: "Insert" }));
  expect(view.state.doc.eq(before)).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("Cursor is inside another table");
  expect(screen.getByRole("dialog", { name: /Insert Table/ })).toBeTruthy();
  const submits = () => logs.filter(({ payload }) => payload.event === "ui.table-modal.submit");
  expect(submits().map(({ payload }) => payload.status)).toEqual(["fail"]);
  let outside = -1;
  view.state.doc.descendants((node, pos) => { if (node.type.name === "paragraph" && node.textContent === "outside") outside = pos + 1; });
  expect(outside).toBeGreaterThanOrEqual(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(outside))));
  await userEvent.click(screen.getByRole("button", { name: "Insert" }));
  await flush();
  expect(view.state.doc.eq(before)).toBe(false);
  expect(screen.queryByRole("dialog", { name: /Insert Table/ })).toBeNull();
  expect(submits().map(({ payload }) => payload.status)).toEqual(["fail", "success"]);
  hook.unmount();
});
