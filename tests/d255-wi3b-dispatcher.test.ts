import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
const imageResponses = vi.hoisted(() => ({ enabled: false, picker: null as Promise<string | null> | null }));
vi.mock("@tauri-apps/api/core", async () => {
  const harness = await import("./support/menuEventsHarness");
  return {
    ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
    invoke: (command: string, args?: { payload?: Record<string, unknown> }) => {
      if (imageResponses.enabled && command === "pick_image") return imageResponses.picker ?? Promise.resolve("/tmp/picture.png");
      if (imageResponses.enabled && command === "copy_external_image") return Promise.resolve({ relativePath: "assets/picture.png", absolutePath: "/x/assets/picture.png", markdownSyntax: "![](assets/picture.png)" });
      return harness.invokeCapturingLogs(command, args);
    },
    convertFileSrc: (p: string) => `asset://${p}`,
  };
});

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { serializerCtx } from "@milkdown/kit/core";
import { dispatchEditorMenuAction } from "../src/hooks/editorMenuActionTable";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import { captureToken } from "../src/utils/menuTargetToken";
import { doc, seedStores } from "./support/editorGenerationDomain";
import { logs } from "./support/menuEventsHarness";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";

let source: EditorView | null = null;
let root: HTMLElement | null = null;
let wysiwyg: MilkdownRig | null = null;
let unregister: (() => void) | null = null;

beforeEach(() => {
  imageResponses.enabled = false;
  imageResponses.picker = null;
  seedStores();
  useDocumentStore.setState({ documents: [doc("d1", "alpha")], activeDocumentId: "d1" });
  logs.length = 0;
  useToastStore.getState().clearToast();
});

afterEach(async () => {
  unregister?.();
  source?.destroy();
  root?.remove();
  await wysiwyg?.destroy();
  unregister = null;
  source = null;
  root = null;
  wysiwyg = null;
});

function mountSource(markdown = "alpha") {
  root = document.body.appendChild(document.createElement("div"));
  source = new EditorView({ state: EditorState.create({ doc: markdown }), parent: root });
  useEditorStore.setState({ viewMode: "source" });
  useEditorStore.getState().setEditorView(source);
  return source;
}

async function mountWysiwyg(markdown = "alpha") {
  wysiwyg = await mountScriptedMilkdownRig(markdown, { heights: [30] });
  unregister = useMilkdownEditorStore.getState().registerEditor(() => wysiwyg?.editor ?? null);
  useEditorStore.setState({ viewMode: "wysiwyg" });
  return wysiwyg;
}

function click(id: string, token = captureToken("main")) {
  return dispatchEditorMenuAction(`editor.${id}`, token);
}

function outcomes(id: string) {
  return logs.filter((entry) => entry.payload.event === "ui.menu.select" && entry.payload.context?.controlId === `editor.${id}`)
    .map((entry) => entry.payload.status);
}

it("AC-12 W heading and Select Word dispatch once with real effects and success logs", async () => {
  const editor = await mountWysiwyg("alpha");
  expect(click("paragraph.increaseHeading")).toBe(true);
  expect(editor.editor.action((ctx) => ctx.get(serializerCtx)(editor.view.state.doc))).toBe("###### alpha\n");
  expect(outcomes("paragraph.increaseHeading")).toEqual(["success"]);
  expect(click("edit.selectWord")).toBe(true);
  expect(editor.view.state.doc.textBetween(editor.view.state.selection.from, editor.view.state.selection.to)).toBe("alpha");
  expect(outcomes("edit.selectWord")).toEqual(["success"]);
});

it("AC-12 Source Underline dispatches once; Clear Format refuses with the wrong-mode toast", () => {
  const editor = mountSource("alpha");
  editor.dispatch({ selection: { anchor: 0, head: 5 } });
  expect(click("format.underline")).toBe(true);
  expect(editor.state.doc.toString()).toBe("<u>alpha</u>");
  expect(outcomes("format.underline")).toEqual(["success"]);
  expect(click("format.clearFormat")).toBe(true);
  expect(editor.state.doc.toString()).toBe("<u>alpha</u>");
  expect(outcomes("format.clearFormat")).toEqual(["cancel"]);
  expect(useToastStore.getState().message).toBe("Available in WYSIWYG mode only");
});

it("AC-12 stale and modal tokens refuse without changing the document", () => {
  const editor = mountSource("alpha");
  const stale = { ...captureToken("main"), generation: -1 };
  expect(click("format.underline", stale)).toBe(true);
  expect(outcomes("format.underline")).toEqual(["cancel"]);
  const modal = document.body.appendChild(document.createElement("div"));
  modal.setAttribute("aria-modal", "true");
  expect(click("format.underline")).toBe(true);
  modal.remove();
  expect(outcomes("format.underline")).toEqual(["cancel", "cancel"]);
  expect(editor.state.doc.toString()).toBe("alpha");
});

it("AC-12 unknown alias is ignored without a log", () => {
  mountSource();
  expect(click("format.notACommand")).toBe(false);
  expect(logs).toEqual([]);
});

it("AC-12 Image records an opened stage before its final cancellation", async () => {
  const editor = mountSource("alpha");
  expect(click("format.image")).toBe(true);
  const stages = () => logs.filter((entry) => entry.payload.event === "ui.menu.select"
    && entry.payload.context?.controlId === "editor.format.image")
    .map((entry) => entry.payload.context?.stage);
  expect(stages()).toContain("opened");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(stages().at(-1)).toBe("complete");
  expect(editor.state.doc.toString()).toBe("alpha");
});

it("AC-12 Image logs opened then cancel, never a premature success", async () => {
  const editor = mountSource("alpha");
  expect(click("format.image")).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const entries = logs.filter((entry) => entry.payload.event === "ui.menu.select"
    && entry.payload.context?.controlId === "editor.format.image");
  expect(entries.map((entry) => entry.payload.status)).toEqual(["start", "cancel"]);
  expect(entries.map((entry) => entry.payload.context?.stage)).toEqual(["opened", "complete"]);
  expect(new Set(entries.map((entry) => entry.payload.actionId)).size).toBe(1);
  expect(editor.state.doc.toString()).toBe("alpha");
});

it.each([
  ["paragraph.decreaseHeading", "## alpha", "### alpha\n"],
  ["edit.selectLine", "alpha beta", "alpha beta\n"],
  ["format.underline", "alpha", "<u>alpha</u>\n"],
  ["format.clearFormat", "**alpha**", "alpha\n"],
])("AC-12 W dispatcher applies %s with a real editor effect", async (id, input, expected) => {
  const editor = await mountWysiwyg(input);
  if (id === "format.underline" || id === "format.clearFormat") {
    const size = editor.view.state.doc.firstChild!.content.size;
    editor.view.dispatch(editor.view.state.tr.setSelection(
      (await import("@milkdown/kit/prose/state")).TextSelection.create(editor.view.state.doc, 1, size + 1)));
  }
  expect(click(id)).toBe(true);
  expect(editor.editor.action((ctx) => ctx.get(serializerCtx)(editor.view.state.doc))).toBe(expected);
  expect(outcomes(id)).toEqual(["success"]);
});

it.each(["format.clearFormat"])(
  "AC-12 Source dispatcher rejects W-only %s with one wrong-mode outcome", (id) => {
    const editor = mountSource("alpha");
    expect(click(id)).toBe(true);
    expect(outcomes(id)).toEqual(["cancel"]);
    expect(editor.state.doc.toString()).toBe("alpha");
    expect(useToastStore.getState().message).toBe("Available in WYSIWYG mode only");
  },
);

it("AC-12 both-mode heading and Select Word dispatch in Source", () => {
  const editor = mountSource("alpha beta");
  expect(click("paragraph.increaseHeading")).toBe(true);
  expect(editor.state.doc.toString()).toBe("###### alpha beta");
  expect(outcomes("paragraph.increaseHeading")).toEqual(["success"]);
  expect(click("edit.selectWord")).toBe(true);
  expect(editor.state.selection.main.to).toBeGreaterThan(editor.state.selection.main.from);
  expect(outcomes("edit.selectWord")).toEqual(["success"]);
  expect(click("paragraph.decreaseHeading")).toBe(true);
  expect(editor.state.doc.toString()).toBe("alpha beta");
  expect(outcomes("paragraph.decreaseHeading")).toEqual(["success"]);
});

it("AC-12 missing token, document and view are separate refusals", async () => {
  const editor = await mountWysiwyg("alpha");
  expect(dispatchEditorMenuAction("editor.paragraph.increaseHeading")).toBe(true);
  expect(outcomes("paragraph.increaseHeading")).toEqual(["cancel"]);
  expect(click("paragraph.increaseHeading", { ...captureToken("main"), documentId: null })).toBe(true);
  expect(outcomes("paragraph.increaseHeading")).toEqual(["cancel", "cancel"]);
  unregister?.();
  unregister = null;
  expect(click("paragraph.increaseHeading")).toBe(true);
  expect(outcomes("paragraph.increaseHeading")).toEqual(["cancel", "cancel", "cancel"]);
  expect(editor.editor.action((ctx) => ctx.get(serializerCtx)(editor.view.state.doc))).toBe("alpha\n");
});

it("AC-12 destroyed and read-only Source views refuse Underline", () => {
  const editor = mountSource("alpha");
  editor.destroy();
  expect(click("format.underline")).toBe(true);
  expect(outcomes("format.underline")).toEqual(["cancel"]);
  root?.remove();
  root = document.body.appendChild(document.createElement("div"));
  source = new EditorView({ state: EditorState.create({ doc: "alpha", extensions: [EditorState.readOnly.of(true)] }), parent: root });
  useEditorStore.getState().setEditorView(source);
  expect(click("format.underline")).toBe(true);
  expect(outcomes("format.underline")).toEqual(["cancel", "cancel"]);
  expect(source.state.doc.toString()).toBe("alpha");
});

it("AC-12 Image completes successfully through the dispatcher", async () => {
  const editor = mountSource("alpha");
  imageResponses.enabled = true;
  expect(click("format.image")).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(editor.state.doc.toString()).toBe("![](assets/picture.png)alpha");
  expect(outcomes("format.image")).toEqual(["start", "success"]);
});

it("AC-12 WYSIWYG Image completes successfully through the dispatcher", async () => {
  const editor = await mountWysiwyg("alpha");
  imageResponses.enabled = true;
  expect(click("format.image")).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(editor.editor.action((ctx) => ctx.get(serializerCtx)(editor.view.state.doc))).toContain("![](assets/picture.png)");
  expect(outcomes("format.image")).toEqual(["start", "success"]);
});

it("AC-7 replaced WYSIWYG editor logs one stale terminal outcome without inserting", async () => {
  const oldEditor = await mountWysiwyg("alpha");
  let releasePicker!: (path: string) => void;
  imageResponses.enabled = true;
  imageResponses.picker = new Promise<string>((resolve) => { releasePicker = resolve; });
  expect(click("format.image")).toBe(true);
  unregister?.();
  const replacement = await mountWysiwyg("other");
  releasePicker("/tmp/picture.png");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const entries = logs.filter((entry) => entry.payload.event === "ui.menu.select"
    && entry.payload.context?.controlId === "editor.format.image");
  expect(entries.map((entry) => [entry.payload.status, entry.payload.context?.stage, entry.payload.context?.reason]))
    .toEqual([["start", "opened", undefined], ["cancel", "complete", "stale"]]);
  expect(new Set(entries.map((entry) => entry.payload.actionId)).size).toBe(1);
  expect(oldEditor.editor.action((ctx) => ctx.get(serializerCtx)(oldEditor.view.state.doc))).toBe("alpha\n");
  expect(replacement.editor.action((ctx) => ctx.get(serializerCtx)(replacement.view.state.doc))).toBe("other\n");
  await oldEditor.destroy();
});

it("AC-12 W read-only and composing guards refuse a heading change", async () => {
  const editor = await mountWysiwyg("alpha");
  editor.view.setProps({ editable: () => false });
  expect(click("paragraph.increaseHeading")).toBe(true);
  expect(outcomes("paragraph.increaseHeading")).toEqual(["cancel"]);
  editor.view.setProps({ editable: () => true });
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  expect(click("paragraph.increaseHeading")).toBe(true);
  expect(outcomes("paragraph.increaseHeading")).toEqual(["cancel", "cancel"]);
  expect(editor.editor.action((ctx) => ctx.get(serializerCtx)(editor.view.state.doc))).toBe("alpha\n");
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
});
