import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { createPlugin } from "../core/pluginTypes";

export const insertLinkCommand = (view: EditorView): boolean => {
  if (view.state.readOnly) return false;

  const href = window.prompt("Enter URL");
  if (href === null) return false;

  const { state } = view;
  const transaction = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const text = selected.length > 0 ? selected : "link";
    const url = href.trim();
    const insert = `[${text}](${url})`;
    const urlStart = range.from + text.length + 3;
    const urlEnd = urlStart + url.length;

    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlEnd),
    };
  });

  view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

export const linkPlugin = createPlugin({
  name: "link",
  displayName: "Link",
  supportedModes: ["codemirror"],
  priority: 90,
  defaultConfig: {
    enabled: true,
  },
  codemirrorExtension: () =>
    keymap.of([
      {
        key: "Mod-k",
        run: insertLinkCommand,
      },
    ]),
});
