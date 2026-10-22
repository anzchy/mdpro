/** D255-WI-3b: the underline syntax must become an editable Milkdown mark. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { undo } from "@milkdown/kit/prose/history";
import { toMarkdown } from "mdast-util-to-markdown";
import { strongWithOuterUnderline } from "../src/plugins/milkdown/underlineMarkPlugin";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";
import { runEditorMenuCommand } from "../src/utils/editorMenuCommands";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { seedStores } from "./support/editorGenerationDomain";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());

let rig: MilkdownRig | null = null;
let unregister: (() => void) | null = null;

beforeEach(() => {
  seedStores();
  useEditorStore.setState({ viewMode: "wysiwyg" });
});

afterEach(async () => {
  unregister?.();
  unregister = null;
  await rig?.destroy();
  rig = null;
});

async function mount(source: string, blocks?: number) {
  rig = await mountScriptedMilkdownRig(source, { heights: Array(blocks ?? (source.includes("\n\n") ? 2 : 1)).fill(30) });
  unregister = useMilkdownEditorStore.getState().registerEditor(() => rig?.editor ?? null);
  return rig;
}

function serialized(): string {
  return rig!.editor.action((ctx) => ctx.get(serializerCtx)(rig!.view.state.doc));
}

function markNames(): string[] {
  return rig!.view.state.doc.firstChild?.firstChild?.marks.map((mark) => mark.type.name) ?? [];
}

function toggle() {
  return runEditorMenuCommand("format.underline", { windowLabel: "main", documentId: "d1", generation: 0 }, "underline-test");
}

it("AC-5 loads and saves simple underline as a real mark", async () => {
  await mount("<u>x</u>");
  expect(markNames()).toContain("underline");
  expect(serialized()).toBe("<u>x</u>\n");
  expect(rig!.view.dom.querySelector("u")?.textContent).toBe("x");
});

it.each(["**<u>x</u>**", "<u>**x**</u>"])('AC-5 nested mark "%s" remains editable and round-trips', async (source) => {
  await mount(source);
  expect(markNames()).toEqual(expect.arrayContaining(["strong", "underline"]));
  expect(serialized()).toBe(`${source}\n`);
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 2)));
  expect(toggle()).toEqual({ status: "applied" });
  expect(serialized()).toBe("**x**\n");
  expect(undo(view.state, view.dispatch, view)).toBe(true);
  expect(serialized()).toBe(`${source}\n`);
});

it.each(["<u>", "<u>x\n\ny</u>", "<U>x</U>", '<u class="a">x</u>', "`<u>x</u>`"])(
  'AC-5 leaves unsupported underline syntax "%s" unchanged', async (source) => {
    await mount(source);
    expect(serialized()).toBe(`${source}\n`);
    expect(markNames()).not.toContain("underline");
  },
);

it.each([
  ["<u>\n\npara\n\n</u>", 3],
  ["<u>\n\n```\ncode\n```\n\n</u>", 3],
  ["<u>\n\np1\n\np2\n\n</u>", 4],
] as const)("AC-5 preserves root HTML blocks through the editor composition: %s", async (source, blocks) => {
  await mount(source, blocks);
  expect(serialized()).toBe(`${source}\n`);
  if (source.includes("```")) {
    const view = rig!.view;
    let codePos = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "code_block") codePos = pos;
    });
    expect(codePos).toBeGreaterThanOrEqual(0);
    const textPos = codePos + 1;
    const codeText = view.state.doc.nodeAt(textPos);
    expect(codeText?.marks.some((mark) => mark.type.name === "underline")).toBe(false);
    view.dispatch(view.state.tr.insertText("X", textPos + 1));
    expect(view.state.doc.nodeAt(textPos)?.text).toContain("X");
    expect(view.state.doc.nodeAt(textPos)?.marks.some((mark) => mark.type.name === "underline")).toBe(false);
  }
});

it("AC-5 keeps a document without underline byte-identical", async () => {
  await mount("ordinary **bold** text");
  expect(serialized()).toBe("ordinary **bold** text\n");
  expect(markNames()).not.toContain("underline");
});

it("AC-5 ordinary strong writer encodes surrounding and boundary characters", () => {
  const markdown = toMarkdown({
    type: "root", children: [{ type: "paragraph", children: [
      { type: "text", value: "a" },
      { type: "strong", children: [{ type: "text", value: " x " }] },
      { type: "text", value: "b" },
    ] }],
  }, { handlers: { strong: strongWithOuterUnderline } });
  expect(markdown).toBe("&#x61;**&#x20;x&#x20;**&#x62;\n");
});

it("AC-5 toggles underline on selected text and off in one undo step", async () => {
  await mount("alpha");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  expect(toggle()).toEqual({ status: "applied" });
  expect(serialized()).toBe("<u>alpha</u>\n");
  expect(undo(view.state, view.dispatch, view)).toBe(true);
  expect(serialized()).toBe("alpha\n");
});

it("AC-4 clears parsed underline and strong together, then undo restores both", async () => {
  await mount("**<u>alpha</u>**");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  expect(runEditorMenuCommand("format.clearFormat", { windowLabel: "main", documentId: "d1", generation: 0 }, "clear-underline"))
    .toEqual({ status: "applied" });
  expect(serialized()).toBe("alpha\n");
  expect(undo(view.state, view.dispatch, view)).toBe(true);
  expect(serialized()).toBe("**<u>alpha</u>**\n");
});

it("AC-4 clears the outer underline form and undo restores its exact spelling", async () => {
  await mount("<u>**alpha**</u>");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  expect(runEditorMenuCommand("format.clearFormat", { windowLabel: "main", documentId: "d1", generation: 0 }, "clear-underline"))
    .toEqual({ status: "applied" });
  expect(serialized()).toBe("alpha\n");
  expect(undo(view.state, view.dispatch, view)).toBe(true);
  expect(serialized()).toBe("<u>**alpha**</u>\n");
});

it("AC-5 empty-caret underline applies to subsequent input and can be toggled off", async () => {
  await mount("alpha");
  const view = rig!.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
  expect(toggle()).toEqual({ status: "applied" });
  view.dispatch(view.state.tr.insertText("X"));
  expect(serialized()).toBe("al<u>X</u>pha\n");
  expect(toggle()).toEqual({ status: "applied" });
  view.dispatch(view.state.tr.insertText("Y"));
  expect(serialized()).toBe("al<u>X</u>Ypha\n");
});
