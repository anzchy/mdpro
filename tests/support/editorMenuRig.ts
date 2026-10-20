/** Real Milkdown and CodeMirror views for M3b menu-dispatch tests. */
import { defaultValueCtx, Editor, editorViewCtx, rootCtx } from "@milkdown/kit/core";
import { gfm } from "@milkdown/kit/preset/gfm";
import type { EditorView as MilkdownView } from "@milkdown/kit/prose/view";
import { EditorState as CodeMirrorState } from "@codemirror/state";
import { EditorView as CodeMirrorView, keymap } from "@codemirror/view";
import { mdproCommonmark } from "../../src/plugins/milkdown/commonmarkPreset";
import { typoraKeymapMilkdownPlugin } from "../../src/plugins/milkdown/typoraKeymapPlugin";
import { heading2Command, paragraphCommand } from "../../src/plugins/codemirror/headingPlugin";
import { insertLinkCommand } from "../../src/plugins/codemirror/linkPlugin";

export interface MilkdownMenuRig {
  editor: Editor;
  view: MilkdownView;
  destroy(): Promise<void>;
}

export async function mountMilkdownMenuRig(markdown: string): Promise<MilkdownMenuRig> {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(mdproCommonmark)
    .use(gfm)
    .use(typoraKeymapMilkdownPlugin)
    .create();
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  return {
    editor,
    view,
    async destroy() {
      await editor.destroy();
      root.remove();
    },
  };
}

export interface SourceMenuRig {
  view: CodeMirrorView;
  destroy(): void;
}

export function mountSourceMenuRig(markdown: string): SourceMenuRig {
  const root = document.body.appendChild(document.createElement("div"));
  const state = CodeMirrorState.create({
    doc: markdown,
    extensions: [
      keymap.of([
        { key: "Mod-2", run: heading2Command },
        { key: "Mod-0", run: paragraphCommand },
        { key: "Mod-k", run: insertLinkCommand },
      ]),
    ],
  });
  const view = new CodeMirrorView({ state, parent: root });
  return {
    view,
    destroy() {
      view.destroy();
      root.remove();
    },
  };
}
