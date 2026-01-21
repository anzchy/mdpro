import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";
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

  for (let i = 1; i <= view.state.doc.lines; i += 1) {
    const line = view.state.doc.line(i);
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

      update(update: { view: EditorView; docChanged: boolean; selectionSet: boolean }) {
        if (update.docChanged || update.selectionSet) {
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
