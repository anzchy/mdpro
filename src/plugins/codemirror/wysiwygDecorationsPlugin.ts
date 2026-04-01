import "./wysiwygDecorationsPlugin.css";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { WidgetType } from "@codemirror/view";
import { createPlugin, type PluginConfig } from "../core/pluginTypes";

export type WysiwygDecorationsOptions = {
  hideHeadings: boolean;
  hideLists: boolean;
  hideQuotes: boolean;
  hideCodeFences: boolean;
};

const defaultOptions: WysiwygDecorationsOptions = {
  hideHeadings: true,
  hideLists: true,
  hideQuotes: true,
  hideCodeFences: true,
};

class InlineMarkerWidget extends WidgetType {
  constructor(private readonly text: string, private readonly className: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = this.className;
    span.textContent = this.text;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

const headingWidget = (level: number) =>
  new InlineMarkerWidget(`H${level}`, "wysiwyg-marker wysiwyg-heading");

const listWidget = (marker: string) =>
  new InlineMarkerWidget(marker, "wysiwyg-marker wysiwyg-list");

const quoteWidget = () => new InlineMarkerWidget(">", "wysiwyg-marker wysiwyg-quote");

const codeFenceWidget = () =>
  new InlineMarkerWidget("```", "wysiwyg-marker wysiwyg-code");

const resolveOptions = (
  options?: WysiwygDecorationsOptions,
): WysiwygDecorationsOptions => ({
  ...defaultOptions,
  ...(options ?? {}),
});

const buildDecorations = (
  view: EditorView,
  options: WysiwygDecorationsOptions,
): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const activeLines = new Set<number>();

  for (const range of state.selection.ranges) {
    activeLines.add(state.doc.lineAt(range.from).number);
    activeLines.add(state.doc.lineAt(range.to).number);
  }

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      if (!activeLines.has(line.number)) {
        const text = line.text;
        const headingMatch = text.match(/^(#{1,6})\s+/);
        if (headingMatch && options.hideHeadings) {
          const length = headingMatch[0].length;
          builder.add(
            line.from,
            line.from + length,
            Decoration.replace({ widget: headingWidget(headingMatch[1].length) }),
          );
        } else {
          if (options.hideLists) {
            const listMatch = text.match(/^(\s*)([-*+]|\d+\.)\s+/);
            if (listMatch) {
              const start = line.from + listMatch[1].length;
              const end = line.from + listMatch[0].length;
              builder.add(start, end, Decoration.replace({ widget: listWidget(listMatch[2]) }));
            }
          }

          if (options.hideQuotes) {
            const quoteMatch = text.match(/^(>+)\s+/);
            if (quoteMatch) {
              const end = line.from + quoteMatch[0].length;
              builder.add(line.from, end, Decoration.replace({ widget: quoteWidget() }));
            }
          }

          if (options.hideCodeFences) {
            const codeMatch = text.match(/^```\w*/);
            if (codeMatch) {
              const end = line.from + codeMatch[0].length;
              builder.add(line.from, end, Decoration.replace({ widget: codeFenceWidget() }));
            }
          }
        }
      }
      pos = line.to + 1;
    }
  }

  return builder.finish();
};

const createWysiwygPlugin = (options: WysiwygDecorationsOptions): Extension =>
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
    {
      decorations: (value) => value.decorations,
    },
  );

export const wysiwygDecorationsPlugin = createPlugin<WysiwygDecorationsOptions>({
  name: "wysiwyg-decorations",
  displayName: "WYSIWYG Decorations",
  supportedModes: ["codemirror"],
  priority: 40,
  defaultConfig: {
    enabled: true,
    options: { ...defaultOptions },
  } as PluginConfig<WysiwygDecorationsOptions>,
  codemirrorExtension: (config) => {
    const options = resolveOptions(config.options as WysiwygDecorationsOptions | undefined);
    return [createWysiwygPlugin(options)];
  },
});
