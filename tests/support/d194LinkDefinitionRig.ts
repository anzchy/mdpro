/**
 * Purpose: D194 / ADR-0094 helpers on top of the D188 rig (tests/support/d188EmptyParagraphRig),
 * which stays untouched. They read the `link_definition` block nodes of the mounted editor and
 * drive the node-level gestures (select as a NodeSelection, delete, undo) the D194 stability
 * tests need.
 *
 * Contract the implementation must satisfy (ADR-0094, option B + display (i)):
 * - node name `link_definition`, a block atom with attrs `identifier` (normalized lowercase
 *   label), `label` (as written), `url`, `title` (null when absent) and `raw` (the exact source
 *   slice of the definition);
 * - its DOM is a block element carrying `data-type="link-definition"` and
 *   `contenteditable="false"`, whose textContent is `raw`.
 *
 * @coordinates-with tests/support/d188EmptyParagraphRig.tsx — the rig these helpers drive
 * @coordinates-with tests/helpers/milkdownEditorHarness.tsx — `viewOf`
 */
import { act } from "@testing-library/react";
import { closeHistory, undo } from "@milkdown/kit/prose/history";
import { NodeSelection } from "@milkdown/kit/prose/state";
import { viewOf } from "../helpers/milkdownEditorHarness";
import type { Rig } from "./d188EmptyParagraphRig";

/** The ProseMirror node name ADR-0094 gives a link reference definition. */
export const DEFINITION_NODE = "link_definition";
/** The DOM selector of a rendered definition block (named here, owned by D194). */
export const DEFINITION_SELECTOR = '[data-type="link-definition"]';

export interface DefinitionAttrs {
  identifier: unknown;
  label: unknown;
  url: unknown;
  title: unknown;
  raw: unknown;
}

/** Every `link_definition` node in document order, with its position. */
export function definitions(rig: Rig): { pos: number; attrs: DefinitionAttrs }[] {
  const out: { pos: number; attrs: DefinitionAttrs }[] = [];
  viewOf(rig.editor()).state.doc.descendants((node, pos) => {
    if (node.type.name === DEFINITION_NODE) {
      const { identifier, label, url, title, raw } = node.attrs;
      out.push({ pos, attrs: { identifier, label, url, title, raw } });
    }
    return true;
  });
  return out;
}

/** The rendered definition blocks inside the editor's DOM. */
export function definitionElements(rig: Rig): HTMLElement[] {
  return Array.from(viewOf(rig.editor()).dom.querySelectorAll<HTMLElement>(DEFINITION_SELECTOR));
}

/**
 * A user gesture: select the `index`-th definition as a node and delete it. The deletion is
 * closed as its own history event so an undo restores it alone.
 */
export function deleteDefinition(rig: Rig, index = 0): void {
  const found = definitions(rig);
  if (index >= found.length) {
    throw new Error(`rig: the document has ${found.length} link_definition node(s), wanted #${index}`);
  }
  const view = viewOf(rig.editor());
  act(() => {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, found[index].pos)));
  });
  const sel = view.state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== DEFINITION_NODE) {
    throw new Error("rig: the definition could not be selected as a node");
  }
  act(() => {
    view.dispatch(closeHistory(view.state.tr.deleteSelection()));
  });
}

/** The app's history plugin: undo the last event. */
export function undoOnce(rig: Rig): void {
  const view = viewOf(rig.editor());
  act(() => {
    undo(view.state, view.dispatch);
  });
}
