import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { EditorSelection } from "@codemirror/state";
import { dispatchEditorMenuAction } from "../src/hooks/editorMenuActionTable";
import { captureToken } from "../src/utils/menuTargetToken";
import { useEditorStore } from "../src/stores/editorStore";
import { useToastStore } from "../src/stores/toastStore";
import { logs } from "./support/menuEventsHarness";
import { resetMenuHarness } from "./support/menuEventsDomain";
import { seedStores } from "./support/editorGenerationDomain";
import { mountSourceMenuRig, type SourceMenuRig } from "./support/editorMenuRig";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { serializerCtx } from "@milkdown/kit/core";

let rig: SourceMenuRig | null = null;
let milkdown: MilkdownRig | null = null;
let modal: HTMLElement | null = null;

function setup(doc = "alpha", readOnly = false): SourceMenuRig {
  resetMenuHarness();
  seedStores();
  useToastStore.getState().clearToast();
  rig = mountSourceMenuRig(doc, readOnly);
  useEditorStore.getState().setEditorView(rig.view);
  useEditorStore.setState({ viewMode: "source" });
  return rig;
}

function outcomes() {
  return logs.filter((entry) => entry.payload.event === "ui.menu.select");
}

beforeEach(() => {
  resetMenuHarness();
  seedStores();
  useToastStore.getState().clearToast();
});

afterEach(async () => {
  await milkdown?.destroy();
  milkdown = null;
  useMilkdownEditorStore.getState().unregisterEditor();
  modal?.remove();
  modal = null;
  rig?.destroy();
  rig = null;
  useToastStore.getState().clearToast();
});

it.each([
  ["format.strong", "**alpha**"],
  ["format.emphasis", "*alpha*"],
  ["format.code", "`alpha`"],
  ["format.strike", "~~alpha~~"],
  ["paragraph.codeFences", "```\nalpha\n```"],
  ["paragraph.orderedList", "1. alpha"],
  ["paragraph.unorderedList", "- alpha"],
  ["paragraph.mathBlock", "$$\nalpha\n$$"],
  ["edit.deleteWord", ""],
])("WI-6 menu %s changes Source exactly once and logs success", (id, want) => {
  const view = setup().view;
  view.dispatch({ selection: id === "edit.deleteWord" ? EditorSelection.cursor(5) : EditorSelection.single(0, 5) });
  expect(dispatchEditorMenuAction(`editor.${id}`, captureToken("main"))).toBe(true);
  expect(view.state.doc.toString()).toBe(want);
  expect(outcomes()).toHaveLength(1);
  expect(outcomes()[0].payload.status).toBe("success");
  expect(outcomes()[0].payload.context?.controlId).toBe(`editor.${id}`);
});

it("Fix 1 public v2 Quote applies through Source menu", () => {
  const view = setup("  a\n  b").view;
  view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
  const token = captureToken("main");
  expect(dispatchEditorMenuAction("editor.paragraph.quote", token)).toBe(true);
  expect(view.state.doc.toString()).toBe("  > a\n  > b");
  expect(outcomes()[0].payload.status).toBe("success");
});

it("Fix 1 public v2 Replace focuses Replace from closed and open Find panels", () => {
  const view = setup("alpha").view;
  const token = captureToken("main");
  for (let n = 1; n <= 2; n += 1) {
    expect(dispatchEditorMenuAction("editor.edit.replace", token)).toBe(true);
    const panels = view.dom.querySelectorAll(".cm-search");
    expect(panels).toHaveLength(1);
    expect(panels[0].querySelector('input[name="replace"]')).toBe(document.activeElement);
    expect(view.state.doc.toString()).toBe("alpha");
    expect(outcomes()).toHaveLength(n);
    expect(outcomes().at(-1)?.payload.status).toBe("success");
    (panels[0].querySelector('input[name="search"]') as HTMLInputElement).focus();
  }
});

it.each([["paragraph.quote", "> alpha\n"], ["paragraph.orderedList", "1. alpha\n"], ["paragraph.unorderedList", "- alpha\n"]])(
  "Fix 1 v2 WYSIWYG menu %s applies without Source-only toast", async (id, expected) => {
    resetMenuHarness(); seedStores(); useToastStore.getState().clearToast();
    useEditorStore.setState({ viewMode: "wysiwyg" });
    milkdown = await mountScriptedMilkdownRig("alpha", { heights: [30] });
    useMilkdownEditorStore.getState().registerEditor(() => milkdown?.editor ?? null);
    const token = captureToken("main");
    expect(dispatchEditorMenuAction(`editor.${id}`, token)).toBe(true);
    expect(milkdown.editor.action((ctx) => ctx.get(serializerCtx)(milkdown!.view.state.doc))).toBe(expected);
    expect(useToastStore.getState().message).toBeNull();
    expect(outcomes()).toHaveLength(1);
    expect(outcomes()[0].payload.status).toBe("success");
  },
);

it("Fix 1 Replace remains unavailable in WYSIWYG without hiding the app", async () => {
  resetMenuHarness(); seedStores(); useToastStore.getState().clearToast();
  useEditorStore.setState({ viewMode: "wysiwyg" });
  milkdown = await mountScriptedMilkdownRig("alpha", { heights: [30] });
  useMilkdownEditorStore.getState().registerEditor(() => milkdown?.editor ?? null);
  expect(dispatchEditorMenuAction("editor.edit.replace", captureToken("main"))).toBe(true);
  expect(milkdown.editor.action((ctx) => ctx.get(serializerCtx)(milkdown!.view.state.doc))).toBe("alpha\n");
  expect(outcomes()).toHaveLength(1);
  expect(outcomes()[0].payload.context?.reason).toBe("wrong_mode");
});

it("WI-6 public Select Line dispatch selects the current Source line once", () => {
  const view = setup("alpha\nbeta").view;
  view.dispatch({ selection: EditorSelection.cursor(2) });
  expect(dispatchEditorMenuAction("editor.edit.selectLine", captureToken("main"))).toBe(true);
  expect(view.state.doc.toString()).toBe("alpha\nbeta");
  expect(view.state.selection.main.from).toBe(0);
  expect(view.state.selection.main.to).toBe(6);
  expect(outcomes()).toHaveLength(1);
  expect(outcomes()[0].payload.status).toBe("success");
  expect(outcomes()[0].payload.context?.controlId).toBe("editor.edit.selectLine");
});

it.each(["paragraph.mathBlock", "edit.selectLine", "edit.deleteWord"])(
  "WI-6 WYSIWYG %s refuses with one cancel when wrong mode or W view is absent", (id) => {
    const view = setup().view;
    useEditorStore.setState({ viewMode: "wysiwyg" });
    const before = view.state.doc.toString();
    const selection = view.state.selection;
    expect(dispatchEditorMenuAction(`editor.${id}`, captureToken("main"))).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
    expect(view.state.selection.eq(selection)).toBe(true);
    expect(outcomes()).toHaveLength(1);
    expect(outcomes()[0].payload.status).toBe("cancel");
    expect(outcomes()[0].payload.context?.reason).toBe(id === "edit.selectLine" ? "missing_view" : "wrong_mode");
    if (id === "edit.selectLine") expect(useToastStore.getState().message).toBeNull();
    else expect(useToastStore.getState().message).toMatch(/Source/);
  },
);

it("WI-6 stale, modal and read-only Source attempts conserve content", () => {
  const view = setup("alpha").view;
  view.dispatch({ selection: EditorSelection.single(0, 5) });
  const stale = { ...captureToken("main"), generation: -1 };
  dispatchEditorMenuAction("editor.format.strong", stale);
  expect(view.state.doc.toString()).toBe("alpha");
  expect(outcomes().at(-1)?.payload.context?.reason).toBe("stale");
  modal = document.body.appendChild(document.createElement("div"));
  modal.setAttribute("aria-modal", "true");
  dispatchEditorMenuAction("editor.format.strong", captureToken("main"));
  expect(view.state.doc.toString()).toBe("alpha");
  expect(outcomes().at(-1)?.payload.context?.reason).toBe("modal_open");
  modal.remove();
  modal = null;
  rig?.destroy();
  rig = mountSourceMenuRig("alpha", true);
  useEditorStore.getState().setEditorView(rig.view);
  dispatchEditorMenuAction("editor.format.strong", captureToken("main"));
  expect(rig.view.state.doc.toString()).toBe("alpha");
  expect(outcomes().at(-1)?.payload.context?.reason).toBe("read_only");
});
