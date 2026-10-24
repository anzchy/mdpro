/** Convert the containing list in one history step, preserving its item subtree. */
import { closeHistory } from "@milkdown/kit/prose/history";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";

/** Null means the selection starts outside a list and the caller should use the preset wrapper. */
export function convertListKind(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  kind: "bullet_list" | "ordered_list",
): boolean | null {
  const { $from, $to } = state.selection;
  let foundList = false;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const list = $from.node(depth);
    if (list.type.name !== "bullet_list" && list.type.name !== "ordered_list") continue;
    foundList = true;
    if ($to.pos > $from.after(depth)) continue;
    if (list.type.name === kind) return false;
    const target = state.schema.nodes[kind];
    if (!target) return false;
    if (dispatch) {
      const attrs = kind === "ordered_list"
        ? { order: 1, spread: list.attrs.spread }
        : { spread: list.attrs.spread };
      dispatch(closeHistory(state.tr).setNodeMarkup($from.before(depth), target, attrs));
    }
    return true;
  }
  return foundList ? false : null;
}
