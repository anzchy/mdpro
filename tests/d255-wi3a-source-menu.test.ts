import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { EditorSelection } from "@codemirror/state";
import { dispatchEditorMenuAction } from "../src/hooks/editorMenuActionTable";
import { runSourceEditorMenuCommand } from "../src/utils/editorMenuSourceCommands";
import { captureToken } from "../src/utils/menuTargetToken";
import { useEditorStore } from "../src/stores/editorStore";
import { useToastStore } from "../src/stores/toastStore";
import { logs } from "./support/menuEventsHarness";
import { resetMenuHarness } from "./support/menuEventsDomain";
import { seedStores } from "./support/editorGenerationDomain";
import { mountSourceMenuRig, type SourceMenuRig } from "./support/editorMenuRig";

let rig: SourceMenuRig | null = null;
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

afterEach(() => {
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

it("WI-6 Quote adapter works directly but public v1 remains hidden", () => {
  const view = setup("  a\n  b").view;
  view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
  const token = captureToken("main");
  expect(runSourceEditorMenuCommand("paragraph.quote", view, token, "direct"))
    .toEqual({ status: "applied" });
  expect(view.state.doc.toString()).toBe("  > a\n  > b");
  const before = view.state.doc.toString();
  expect(dispatchEditorMenuAction("editor.paragraph.quote", token)).toBe(true);
  expect(view.state.doc.toString()).toBe(before);
  expect(outcomes()[0].payload.status).toBe("cancel");
  view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
  expect(runSourceEditorMenuCommand("paragraph.quote", view, token, "direct-again"))
    .toEqual({ status: "applied" });
  expect(view.state.doc.toString()).toBe("  a\n  b");
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
