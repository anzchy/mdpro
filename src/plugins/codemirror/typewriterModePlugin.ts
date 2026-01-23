import { EditorView } from "@codemirror/view";
import { createPlugin, type PluginConfig } from "../core/pluginTypes";

export type TypewriterModeOptions = {
  scrollOffset: number;
};

const defaultOptions: TypewriterModeOptions = {
  scrollOffset: 0.5,
};

const createTypewriterExtension = (options: TypewriterModeOptions) =>
  EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet) return;

    const view = update.view;
    const selection = update.state.selection.main;
    const block = view.lineBlockAt(selection.head);
    const blockMiddle = (block.top + block.bottom) / 2;
    const target = blockMiddle - view.scrollDOM.clientHeight * options.scrollOffset;
    const nextScrollTop = Math.max(0, target);

    if (Math.abs(view.scrollDOM.scrollTop - nextScrollTop) > 1) {
      view.scrollDOM.scrollTop = nextScrollTop;
    }
  });

export const typewriterModePlugin = createPlugin<TypewriterModeOptions>({
  name: "typewriter-mode",
  displayName: "Typewriter Mode",
  supportedModes: ["codemirror"],
  priority: 10,
  defaultConfig: {
    enabled: false,
    options: { ...defaultOptions },
  } as PluginConfig<TypewriterModeOptions>,
  codemirrorExtension: (config) => {
    const options = {
      ...defaultOptions,
      ...(config.options ?? {}),
    } as TypewriterModeOptions;
    return createTypewriterExtension(options);
  },
});
