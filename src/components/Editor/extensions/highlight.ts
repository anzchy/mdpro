import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

const OPEN_TAG = "<mark style=\"background: #FF5582A6;\">";
const CLOSE_TAG = "</mark>";

export const highlightCommand = (view: EditorView) => {
  if (view.state.readOnly) {
    return false;
  }

  const { state } = view;
  const transaction = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const insert = `${OPEN_TAG}${selected}${CLOSE_TAG}`;
    const anchor = range.from + OPEN_TAG.length;
    const head = anchor + selected.length;

    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(anchor, head),
    };
  });

  view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: "input" }));
  return true;
};
