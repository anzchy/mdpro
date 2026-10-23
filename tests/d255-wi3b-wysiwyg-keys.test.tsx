import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
const ipc = vi.hoisted(() => vi.fn());
const commandLogs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (command: string, args?: { payload?: Record<string, unknown> }) => {
    if (command === "log_event") commandLogs.push(args?.payload ?? {});
    return args === undefined ? ipc(command) : ipc(command, args);
  },
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import { v1Applied } from "./support/bindingV1Defaults";
import { doc, seedStores } from "./support/editorGenerationDomain";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";
import { runEditorMenuCommand } from "../src/utils/editorMenuCommands";
import { captureToken } from "../src/utils/menuTargetToken";

let rig: MilkdownRig | null = null;
let unregister: (() => void) | null = null;
let unmountKeys: (() => void) | null = null;

beforeEach(() => {
  seedStores();
  useDocumentStore.setState({ documents: [doc("d1", "alpha")], activeDocumentId: "d1" });
  useEditorStore.setState({ viewMode: "wysiwyg" });
  ipc.mockReset();
  commandLogs.length = 0;
  ipc.mockImplementation(async (command: string) => {
    if (command === "pick_image") return "/tmp/image.png";
    if (command === "copy_external_image") return { relativePath: "assets/image.png", markdownSyntax: "![](assets/image.png)", absolutePath: "/x/assets/image.png" };
    return null;
  });
});

afterEach(async () => {
  unmountKeys?.();
  unmountKeys = null;
  unregister?.();
  unregister = null;
  await rig?.destroy();
  rig = null;
  document.getElementById("milkdown-container")?.remove();
});

async function mount(source: string, appliedShortcuts?: ReturnType<typeof v1Applied>) {
  const root = document.body.appendChild(document.createElement("div"));
  root.id = "milkdown-container";
  rig = await mountScriptedMilkdownRig(source, { heights: [30], container: root, appliedShortcuts });
  unregister = useMilkdownEditorStore.getState().registerEditor(() => rig?.editor ?? null);
  return rig;
}

function press(key: string, mods: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
  act(() => { rig!.view.dom.dispatchEvent(event); });
  return event;
}

function markdown() {
  return rig!.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc));
}

it.each([
  ["alpha", "]", "###### alpha\n"],
  ["## alpha", "[", "### alpha\n"],
])("AC-11 heading key %s / Cmd+Option+%s changes the document once", async (source, key, expected) => {
  await mount(source);
  expect(press(key, { metaKey: true, altKey: true }).defaultPrevented).toBe(true);
  expect(markdown()).toBe(expected);
});

it("M1b A11: consumed WYSIWYG Cmd+= changes the heading without a custom Save", async () => {
  await mount("alpha", v1Applied("macos"));
  const save = vi.fn();
  unmountKeys = renderHook(() => useKeyboardShortcuts({
    onSave: save,
    shortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS, fileSave: "Cmd+=" },
  })).unmount;
  const event = press("=", { metaKey: true });
  expect(event.defaultPrevented).toBe(true);
  expect(markdown()).toBe("###### alpha\n");
  expect(save).not.toHaveBeenCalled();
});

it("AC-11 Cmd+D selects a word and Cmd+L selects its enclosing line", async () => {
  await mount("alpha beta");
  const view = rig!.view;
  expect(press("d", { metaKey: true }).defaultPrevented).toBe(true);
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("alpha");
  expect(press("l", { metaKey: true }).defaultPrevented).toBe(true);
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe("alpha beta");
  expect(markdown()).toBe("alpha beta\n");
});

it("AC-11 Cmd+backslash clears selected bold without changing text", async () => {
  await mount("**alpha**");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  expect(press("\\", { metaKey: true }).defaultPrevented).toBe(true);
  expect(markdown()).toBe("alpha\n");
});

it("AC-11 Cmd+U toggles the real underline mark once", async () => {
  await mount("alpha");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  expect(press("u", { metaKey: true }).defaultPrevented).toBe(true);
  expect(markdown()).toBe("<u>alpha</u>\n");
});

it("AC-11 Cmd+Shift+I inserts a copied image through the picker", async () => {
  await mount("alpha");
  expect(press("i", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(markdown()).toContain("![](assets/image.png)");
  expect(ipc).toHaveBeenCalledWith("pick_image");
});

it("AC-11 existing Cmd+B still adds strong once", async () => {
  await mount("alpha");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  expect(press("b", { metaKey: true }).defaultPrevented).toBe(true);
  expect(markdown()).toBe("**alpha**\n");
});

it("A13-WindowOwner: default window bindings leave WYSIWYG Cmd+Option+] to the editor", async () => {
  await mount("alpha");
  const onSave = vi.fn();
  const keys = renderHook(() => useKeyboardShortcuts({ onSave }));
  unmountKeys = keys.unmount;
  const event = press("]", { metaKey: true, altKey: true });
  expect(event.defaultPrevented).toBe(true);
  expect(markdown()).toBe("###### alpha\n");
  const entries = commandLogs.filter((entry) => entry.event === "ui.editor.command" &&
    (entry.context as { command?: string } | undefined)?.command === "paragraph.increaseHeading");
  expect(entries).toHaveLength(1);
  expect(entries[0].status).toBe("success");
  expect(entries[0].context).toEqual(expect.objectContaining({ mode: "wysiwyg", via: "key" }));
  expect(onSave).not.toHaveBeenCalled();
});

it("AC-11 refused edge key logs cancel and leaves the document unchanged", async () => {
  await mount("# alpha");
  expect(press("]", { metaKey: true, altKey: true }).defaultPrevented).toBe(true);
  expect(markdown()).toBe("# alpha\n");
  const entries = commandLogs.filter((entry) => entry.event === "ui.editor.command" &&
    (entry.context as { command?: string } | undefined)?.command === "paragraph.increaseHeading");
  expect(entries).toHaveLength(1);
  expect(entries[0].status).toBe("cancel");
});

it("AC-7/11 a cancelled menu Image leaves the key path ready", async () => {
  await mount("alpha");
  let picks = 0;
  ipc.mockImplementation(async (command: string) => {
    if (command === "pick_image") return picks++ === 0 ? null : "/tmp/image.png";
    if (command === "copy_external_image") return { relativePath: "assets/image.png", markdownSyntax: "![](assets/image.png)", absolutePath: "/x/assets/image.png" };
    return null;
  });
  expect(runEditorMenuCommand("format.image", captureToken("main"), "menu-cancel")).toEqual({ status: "opened" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(markdown()).toBe("alpha\n");
  expect(press("i", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(markdown()).toContain("![](assets/image.png)");
});
