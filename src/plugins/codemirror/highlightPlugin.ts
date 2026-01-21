import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { createPlugin, type PluginConfig } from "../core/pluginTypes";

const DEFAULT_OPEN_TAG = "<mark style=\"background: #FF5582A6;\">";
const DEFAULT_CLOSE_TAG = "</mark>";

export type HighlightOptions = {
  openTag: string;
  closeTag: string;
};

const resolveOptions = (
  options?: HighlightOptions,
): HighlightOptions => ({
  openTag: options?.openTag ?? DEFAULT_OPEN_TAG,
  closeTag: options?.closeTag ?? DEFAULT_CLOSE_TAG,
});

export const highlightCommand = (
  view: EditorView,
  options?: HighlightOptions,
) => {
  if (view.state.readOnly) {
    return false;
  }

  const { openTag, closeTag } = resolveOptions(options);
  const { state } = view;
  const transaction = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const insert = `${openTag}${selected}${closeTag}`;
    const anchor = range.from + openTag.length;
    const head = anchor + selected.length;

    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(anchor, head),
    };
  });

  view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

export const highlightPlugin = createPlugin<HighlightOptions>({
  name: "highlight",
  displayName: "Highlight",
  supportedModes: ["codemirror"],
  priority: 90,
  defaultConfig: {
    enabled: true,
    options: {
      openTag: DEFAULT_OPEN_TAG,
      closeTag: DEFAULT_CLOSE_TAG,
    },
  } as PluginConfig<HighlightOptions>,
  codemirrorExtension: (config) => {
    const options = resolveOptions(config.options as HighlightOptions | undefined);
    return keymap.of([
      {
        key: "Mod-Shift-h",
        run: (view) => highlightCommand(view, options),
      },
    ]);
  },
});
