import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, type ViewUpdate, ViewPlugin } from "@codemirror/view";
import { createPlugin, type PluginConfig } from "../core/pluginTypes";

export type FocusModeOptions = {
  dimOpacity: number;
};

const defaultOptions: FocusModeOptions = {
  dimOpacity: 0.3,
};

const buildDecorations = (
  view: EditorView,
  options: FocusModeOptions,
): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head);

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      if (line.number !== cursorLine.number) {
        builder.add(
          line.from,
          line.from,
          Decoration.line({
            attributes: {
              style: `opacity: ${options.dimOpacity}`,
            },
          }),
        );
      }
      pos = line.to + 1;
    }
  }

  return builder.finish();
};

const createFocusModePlugin = (options: FocusModeOptions) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, options);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, options);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );

export const focusModePlugin = createPlugin<FocusModeOptions>({
  name: "focus-mode",
  displayName: "Focus Mode",
  supportedModes: ["codemirror"],
  priority: 20,
  defaultConfig: {
    enabled: false,
    options: { ...defaultOptions },
  } as PluginConfig<FocusModeOptions>,
  codemirrorExtension: (config) => {
    const options = {
      ...defaultOptions,
      ...(config.options ?? {}),
    } as FocusModeOptions;
    return createFocusModePlugin(options);
  },
});
