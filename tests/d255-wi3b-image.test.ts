/** D255-WI-3b: Image picker lifecycle against real stores and editors. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo as sourceUndo } from "@codemirror/commands";
import { undo as wysiwygUndo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { serializerCtx } from "@milkdown/kit/core";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import { runEditorMenuCommand } from "../src/utils/editorMenuCommands";
import { captureToken } from "../src/utils/menuTargetToken";
import { doc, seedStores } from "./support/editorGenerationDomain";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";

const ipc = vi.hoisted(() => vi.fn());
const windowState = vi.hoisted(() => ({ label: "main" }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: ipc,
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: windowState.label }) }));

let source: EditorView | null = null;
let sourceRoot: HTMLElement | null = null;
let wysiwyg: MilkdownRig | null = null;
let unregister: (() => void) | null = null;

const copied = { relativePath: "assets/picture.png", absolutePath: "/docs/assets/picture.png", markdownSyntax: "![](assets/picture.png)" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  windowState.label = "main";
  seedStores();
  useDocumentStore.setState({ documents: [doc("d1", "alpha"), doc("d2", "other")], activeDocumentId: "d1" });
  ipc.mockReset();
  ipc.mockImplementation(async (command: string) => {
    if (command === "pick_image") return "/tmp/picture.png";
    if (command === "copy_external_image") return copied;
    return null;
  });
});

afterEach(async () => {
  unregister?.();
  source?.destroy();
  sourceRoot?.remove();
  await wysiwyg?.destroy();
  document.getElementById("milkdown-container")?.remove();
  unregister = null;
  source = null;
  sourceRoot = null;
  wysiwyg = null;
  useEditorStore.getState().setEditorView(null);
});

function mountSource(text = "alpha") {
  sourceRoot = document.body.appendChild(document.createElement("div"));
  source = new EditorView({ state: EditorState.create({ doc: text, selection: EditorSelection.cursor(text.length), extensions: [history()] }), parent: sourceRoot });
  useEditorStore.setState({ viewMode: "source" });
  useEditorStore.getState().setEditorView(source);
  return source;
}

async function mountWysiwyg() {
  const root = document.body.appendChild(document.createElement("div"));
  root.id = "milkdown-container";
  wysiwyg = await mountScriptedMilkdownRig("alpha", { heights: [30], container: root });
  unregister = useMilkdownEditorStore.getState().registerEditor(() => wysiwyg?.editor ?? null);
  useEditorStore.setState({ viewMode: "wysiwyg" });
  return wysiwyg;
}

function start() {
  return runEditorMenuCommand("format.image", captureToken("main"), "image-test");
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

it("AC-7 refuses untitled before picker and shows the paste toast", async () => {
  const editor = mountSource();
  useDocumentStore.setState({ documents: [doc("d1")], activeDocumentId: "d1" });
  useDocumentStore.setState({ documents: [{ ...doc("d1"), path: null }], activeDocumentId: "d1" });
  expect(start()).toEqual({ status: "refused", reason: "no_change" });
  await settle();
  expect(ipc).not.toHaveBeenCalledWith("pick_image");
  expect(editor.state.doc.toString()).toBe("alpha");
  expect(useToastStore.getState().message).toBe("Save the document before pasting images");
});

it("AC-7 inserts a picked, copied image in Source and cancels cleanly", async () => {
  const editor = mountSource();
  expect(start()).toEqual({ status: "opened" });
  await settle();
  expect(editor.state.doc.toString()).toBe("alpha![](assets/picture.png)");
  expect(ipc).toHaveBeenCalledWith("copy_external_image", expect.objectContaining({ documentPath: "/x/d1.md", sourcePath: "/tmp/picture.png" }));
});

it.each(["source", "wysiwyg"] as const)("Fix 1 inserts the returned renamed asset path in %s", async (mode) => {
  const renamed = { relativePath: "./assets/picture-1.png", absolutePath: "/x/assets/picture-1.png", markdownSyntax: "![](./assets/picture-1.png)" };
  ipc.mockImplementation(async (command: string) => command === "pick_image" ? "/tmp/picture.png" : renamed);
  if (mode === "source") {
    const editor = mountSource();
    expect(start()).toEqual({ status: "opened" });
    await settle();
    expect(editor.state.doc.toString()).toBe(`alpha${renamed.markdownSyntax}`);
  } else {
    const editor = await mountWysiwyg();
    expect(start()).toEqual({ status: "opened" });
    await settle();
    expect(editor.editor.action((ctx) => ctx.get(serializerCtx)(editor.view.state.doc))).toContain(renamed.relativePath);
  }
});

it("Fix 1 shows a serialized copy error message in the toast", async () => {
  const editor = mountSource();
  ipc.mockImplementation(async (command: string) => {
    if (command === "pick_image") return "/tmp/picture.png";
    if (command === "copy_external_image") throw { IoError: { message: "disk write failed" } };
    return null;
  });
  expect(start()).toEqual({ status: "opened" });
  await settle();
  expect(editor.state.doc.toString()).toBe("alpha");
  expect(useToastStore.getState().message).toBe("Failed to insert image: disk write failed");
});

it("Fix 1 preserves the serialized ImageError InvalidPath message", async () => {
  const editor = mountSource();
  ipc.mockImplementation(async (command: string) => {
    if (command === "pick_image") return "/tmp/picture.png";
    if (command === "copy_external_image") throw { InvalidPath: { message: "asset folder must be within the document directory" } };
    return null;
  });
  expect(start()).toEqual({ status: "opened" });
  await settle();
  expect(editor.state.doc.toString()).toBe("alpha");
  expect(useToastStore.getState().message).toBe("Failed to insert image: invalid path: asset folder must be within the document directory");
});

it("AC-7 picker cancel and copy rejection leave Source unchanged and unlock the next click", async () => {
  const editor = mountSource();
  const pick = deferred<string | null>();
  ipc.mockImplementation(async (command: string) => command === "pick_image" ? pick.promise : copied);
  expect(start()).toEqual({ status: "opened" });
  expect(start()).toEqual({ status: "refused", reason: "modal_open" });
  pick.resolve(null);
  await settle();
  expect(editor.state.doc.toString()).toBe("alpha");
  ipc.mockImplementation(async (command: string) => command === "pick_image" ? "/tmp/picture.png" : copied);
  expect(start()).toEqual({ status: "opened" });
  await settle();
  expect(editor.state.doc.toString()).toBe("alpha![](assets/picture.png)");
});

it("AC-7 aborts a pending pick after a tab switch and never revives on return", async () => {
  const editor = mountSource();
  const pick = deferred<string>();
  ipc.mockImplementation(async (command: string) => command === "pick_image" ? pick.promise : copied);
  expect(start()).toEqual({ status: "opened" });
  useDocumentStore.getState().setActiveDocument("d2");
  useDocumentStore.getState().setActiveDocument("d1");
  pick.resolve("/tmp/picture.png");
  await settle();
  expect(editor.state.doc.toString()).toBe("alpha");
  expect(ipc).not.toHaveBeenCalledWith("copy_external_image", expect.anything());
});

it("AC-7 resolves newly inserted WYSIWYG image DOM src without remounting", async () => {
  const editor = await mountWysiwyg();
  expect(start()).toEqual({ status: "opened" });
  await settle();
  const image = editor.view.dom.querySelector("img:not(.ProseMirror-separator)");
  expect(image?.getAttribute("src")).toBe("asset:///x/assets/picture.png");
  expect(editor.editor.action((ctx) => ctx.get(serializerCtx)(editor.view.state.doc))).toContain("![](assets/picture.png)");
});

it.each(["picker_reject", "copy_reject"])("AC-7 %s unlocks a second Image operation on the same editor", async (failure) => {
  const editor = mountSource();
  ipc.mockImplementation(async (command: string) => {
    if (command === "pick_image") {
      if (failure === "picker_reject") throw new Error("picker unavailable");
      return "/tmp/picture.png";
    }
    if (command === "copy_external_image") throw new Error("copy denied");
    return null;
  });
  expect(start()).toEqual({ status: "opened" });
  await settle();
  expect(editor.state.doc.toString()).toBe("alpha");
  expect(useToastStore.getState().message).toMatch(/Failed to insert image/);
  ipc.mockImplementation(async (command: string) => command === "pick_image" ? "/tmp/picture.png" : copied);
  expect(start()).toEqual({ status: "opened" });
  await settle();
  expect(editor.state.doc.toString()).toBe("alpha![](assets/picture.png)");
});

it.each(["close", "mode", "destroy"])("AC-7 %s during copy await aborts with no late insertion", async (change) => {
  const editor = mountSource();
  const copy = deferred<typeof copied>();
  ipc.mockImplementation(async (command: string) => command === "pick_image" ? "/tmp/picture.png" : copy.promise);
  expect(start()).toEqual({ status: "opened" });
  await Promise.resolve();
  if (change === "close") useDocumentStore.setState({ documents: [], activeDocumentId: null });
  if (change === "mode") useEditorStore.setState({ viewMode: "wysiwyg" });
  if (change === "destroy") editor.destroy();
  copy.resolve(copied);
  await settle();
  expect(editor.state.doc.toString()).toBe("alpha");
  if (change !== "destroy") {
    useDocumentStore.setState({ documents: [doc("d1", "alpha")], activeDocumentId: "d1" });
    useEditorStore.setState({ viewMode: "source" });
    ipc.mockImplementation(async (command: string) => command === "pick_image" ? "/tmp/picture.png" : copied);
    expect(start()).toEqual({ status: "opened" });
    await settle();
    expect(editor.state.doc.toString()).toBe("alpha![](assets/picture.png)");
  }
});

it("AC-7 resolves two WYSIWYG image DOM URLs in one mounted session", async () => {
  const editor = await mountWysiwyg();
  expect(start()).toEqual({ status: "opened" });
  await settle();
  expect(start()).toEqual({ status: "opened" });
  await settle();
  const images = [...editor.view.dom.querySelectorAll("img:not(.ProseMirror-separator)")];
  expect(images).toHaveLength(2);
  expect(images.map((image) => image.getAttribute("src"))).toEqual([
    "asset:///x/assets/picture.png", "asset:///x/assets/picture.png",
  ]);
  expect(editor.editor.action((ctx) => ctx.get(serializerCtx)(editor.view.state.doc))).toContain("![](assets/picture.png)![](assets/picture.png)");
});

it("AC-7/R8 undoes only the latest of two adjacent Source images", async () => {
  const editor = mountSource();
  expect(start()).toEqual({ status: "opened" });
  await settle();
  expect(start()).toEqual({ status: "opened" });
  await settle();
  expect(editor.state.doc.toString()).toBe("alpha![](assets/picture.png)![](assets/picture.png)");
  expect(sourceUndo(editor)).toBe(true);
  expect(editor.state.doc.toString()).toBe("alpha![](assets/picture.png)");
  expect(sourceUndo(editor)).toBe(true);
  expect(editor.state.doc.toString()).toBe("alpha");
});

it("AC-7/R8 undoes only the latest of two adjacent WYSIWYG images", async () => {
  const editor = await mountWysiwyg();
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, editor.view.state.doc.content.size - 1)));
  expect(start()).toEqual({ status: "opened" });
  await settle();
  expect(start()).toEqual({ status: "opened" });
  await settle();
  const output = () => editor.editor.action((ctx) => ctx.get(serializerCtx)(editor.view.state.doc));
  expect(output()).toContain("![](assets/picture.png)![](assets/picture.png)");
  expect(wysiwygUndo(editor.view.state, editor.view.dispatch, editor.view)).toBe(true);
  expect(output()).toBe("alpha![](assets/picture.png)\n");
  expect(wysiwygUndo(editor.view.state, editor.view.dispatch, editor.view)).toBe(true);
  expect(output()).toBe("alpha\n");
});

it("AC-7 WYSIWYG Image undo restores the exact prior selection and document", async () => {
  const editor = await mountWysiwyg();
  const view = editor.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 4)));
  const priorDocument = view.state.doc;
  const priorSelection = view.state.selection;
  expect(start()).toEqual({ status: "opened" });
  await settle();
  expect(view.state.doc.eq(priorDocument)).toBe(false);
  expect(wysiwygUndo(view.state, view.dispatch, view)).toBe(true);
  expect(view.state.doc.eq(priorDocument)).toBe(true);
  expect(view.state.selection.eq(priorSelection)).toBe(true);
});

it.each(["close", "mode", "destroy"]) ("AC-7 %s during picker await cannot copy or insert", async (change) => {
  const editor = mountSource();
  const pick = deferred<string>();
  ipc.mockImplementation(async (command: string) => command === "pick_image" ? pick.promise : copied);
  expect(start()).toEqual({ status: "opened" });
  if (change === "close") useDocumentStore.setState({ documents: [], activeDocumentId: null });
  if (change === "mode") useEditorStore.setState({ viewMode: "wysiwyg" });
  if (change === "destroy") editor.destroy();
  pick.resolve("/tmp/picture.png");
  await settle();
  expect(editor.state.doc.toString()).toBe("alpha");
  expect(ipc.mock.calls.filter(([name]) => name === "copy_external_image")).toHaveLength(0);
});

it("AC-7 tab switch during copy await cannot insert into the returned tab", async () => {
  const editor = mountSource();
  const copy = deferred<typeof copied>();
  ipc.mockImplementation(async (command: string) => command === "pick_image" ? "/tmp/picture.png" : copy.promise);
  expect(start()).toEqual({ status: "opened" });
  await Promise.resolve();
  useDocumentStore.getState().setActiveDocument("d2");
  useDocumentStore.getState().setActiveDocument("d1");
  copy.resolve(copied);
  await settle();
  expect(editor.state.doc.toString()).toBe("alpha");
});

it("AC-7 path, window and token changes during copy await refuse insertion", async () => {
  for (const change of ["path", "window", "token"] as const) {
    const editor = mountSource();
    const copy = deferred<typeof copied>();
    ipc.mockImplementation(async (command: string) => command === "pick_image" ? "/tmp/picture.png" : copy.promise);
    expect(start()).toEqual({ status: "opened" });
    await Promise.resolve();
    if (change === "path") useDocumentStore.setState({ documents: [{ ...doc("d1", "alpha"), path: "/x/renamed.md" }, doc("d2", "other")], activeDocumentId: "d1" });
    if (change === "window") windowState.label = "other";
    if (change === "token") { useDocumentStore.getState().setActiveDocument("d2"); useDocumentStore.getState().setActiveDocument("d1"); }
    copy.resolve(copied);
    await settle();
    expect(editor.state.doc.toString()).toBe("alpha");
    editor.destroy();
    sourceRoot?.remove();
    source = null;
    sourceRoot = null;
    seedStores();
    windowState.label = "main";
    useDocumentStore.setState({ documents: [doc("d1", "alpha"), doc("d2", "other")], activeDocumentId: "d1" });
  }
});

it("AC-7 inserts the copy service's escaped Markdown syntax exactly", async () => {
  const editor = mountSource();
  const escaped = { ...copied, markdownSyntax: "![](assets/a\\ b\\(1\\).png)" };
  ipc.mockImplementation(async (command: string) => command === "pick_image" ? "/tmp/a b(1).png" : escaped);
  expect(start()).toEqual({ status: "opened" });
  await settle();
  expect(editor.state.doc.toString()).toBe(`alpha${escaped.markdownSyntax}`);
});
