/**
 * ProseMirror placeholder decoration helpers for the image paste pipeline.
 *
 * @coordinates-with imagePastePlugin.ts (consumer of all exports)
 */

import { PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { EditorView } from "@milkdown/kit/prose/view";

export const imagePastePluginKey = new PluginKey("imagePaste");

export interface PlaceholderState {
  decorations: DecorationSet;
}

function createPlaceholderWidget(id: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "image-paste-placeholder";
  el.setAttribute("data-placeholder-id", id);
  el.textContent = "Uploading image…";
  return el;
}

export function addPlaceholders(
  view: EditorView,
  pos: number,
  ids: string[],
): void {
  const { state, dispatch } = view;
  const decorations = ids.map((id) =>
    Decoration.widget(pos, () => createPlaceholderWidget(id), { key: id }),
  );

  const existing =
    imagePastePluginKey.getState(state)?.decorations ?? DecorationSet.empty;
  const next = existing.add(state.doc, decorations);

  dispatch(state.tr.setMeta(imagePastePluginKey, { decorations: next }));
}

export function removePlaceholders(
  view: EditorView,
  ids: string[],
): void {
  const { state, dispatch } = view;
  const existing =
    imagePastePluginKey.getState(state)?.decorations ?? DecorationSet.empty;

  const toRemove = existing.find().filter((d: Decoration) => {
    const el = (d as Decoration & { spec?: { key?: string } }).spec?.key;
    return el && ids.includes(el);
  });

  if (toRemove.length > 0) {
    const next = existing.remove(toRemove);
    dispatch(state.tr.setMeta(imagePastePluginKey, { decorations: next }));
  }
}

export function insertImageNode(
  view: EditorView,
  src: string,
  pos: number,
): void {
  const { state, dispatch } = view;
  const imageType = state.schema.nodes.image;
  if (!imageType) return;

  const node = imageType.create({ src, alt: "" });
  dispatch(state.tr.insert(pos, node));
}

export function insertImageNodes(
  view: EditorView,
  srcs: string[],
  pos: number,
): void {
  const { state, dispatch } = view;
  const imageType = state.schema.nodes.image;
  if (!imageType) return;

  const tr = state.tr;
  let offset = 0;
  for (const src of srcs) {
    const node = imageType.create({ src, alt: "" });
    tr.insert(pos + offset, node);
    offset += node.nodeSize;
  }

  dispatch(tr);
}
