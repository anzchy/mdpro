/**
 * @module emptyParagraph/edgeSerializer
 * Purpose: The write-side edge rule of ADR-0091 (D188, user ruling 2026-10-14:
 * 「(a) 写入时去掉首尾空段落」). Leading and trailing empty paragraphs of the document,
 * a blockquote and a list item are left out of the written Markdown.
 *
 * Pipeline: a projection inside the containers' `toMarkdown` runners. Each runner
 * hands the preset's own runner a copy of the node whose content has the edge
 * empties removed; interior empty paragraphs reach the stock writer and come out as
 * blank lines (`A` + "\n"×(2n+2) + `B`).
 *
 * Key decisions:
 *   - Serialize-only. No transaction is dispatched, so undo and the cursor are
 *     untouched and the live ProseMirror doc keeps a boundary empty paragraph until
 *     it is rebuilt from the bytes (remount, mode switch).
 *   - Not a `$remark` transformer: the serializer only stringifies
 *     (`@milkdown/transformer` serializer state `toString`), so remark transformers
 *     never run on write.
 *   - Containers are kept even when the strip empties them: a container holding
 *     only empty paragraphs keeps exactly one, which the stock writer writes as
 *     nothing (an empty document writes `""`).
 *   - `list_item` extends preset-gfm's task-list schema, not preset-commonmark's, so
 *     task items keep their checkbox; `doc` is a plain `$node` with no
 *     `extendSchema`, so it is re-declared with the preset's own parse rule.
 *   - Register after `commonmark` and `gfm`: a schema id registered later replaces
 *     the earlier spec (precedent: table/emptyCellSerializer.ts).
 *
 * @coordinates-with src/plugins/milkdown/emptyParagraph/blankLineGaps.ts — the reader half
 * @coordinates-with src/plugins/milkdown/emptyParagraph/index.ts — exports the plugin list
 */
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { Fragment, type Node as PmNode } from "@milkdown/kit/prose/model";
import { blockquoteSchema } from "@milkdown/kit/preset/commonmark";
import { extendListItemSchemaForTask } from "@milkdown/kit/preset/gfm";
import { $node, type GetNodeSchema } from "@milkdown/kit/utils";

/** An empty paragraph: no inline content at all (a hard break is content). */
export function isEmptyParagraph(node: PmNode): boolean {
  return node.type.name === "paragraph" && node.content.size === 0;
}

/** `content` without its leading and trailing empty paragraphs. */
export function stripEdgeEmpties(content: Fragment): Fragment {
  const kids: PmNode[] = [];
  content.forEach((child) => kids.push(child));
  let start = 0;
  let end = kids.length;
  while (start < end && isEmptyParagraph(kids[start])) start += 1;
  while (end > start && isEmptyParagraph(kids[end - 1])) end -= 1;
  // All empty: keep one, so the container is written (an empty mdast `root` with no
  // children makes mdast-util-to-markdown throw). It writes as nothing.
  if (start === end && kids.length > 0) [start, end] = [0, 1];
  if (start === 0 && end === kids.length) return content;
  return Fragment.fromArray(kids.slice(start, end));
}

/** `extendSchema` handler: the base runner sees the node with its edges stripped. */
export function edgeStripRule(prev: GetNodeSchema): GetNodeSchema {
  return (ctx) => {
    const base = prev(ctx);
    const baseRunner = base.toMarkdown.runner;
    return {
      ...base,
      toMarkdown: {
        ...base.toMarkdown,
        runner: (state, node) => baseRunner(state, node.copy(stripEdgeEmpties(node.content))),
      },
    };
  };
}

/** preset-commonmark's `doc`, with the edge strip on write. */
const docWithEdgeStrip = $node("doc", () => ({
  content: "block+",
  parseMarkdown: {
    match: ({ type }) => type === "root",
    runner: (state, node, type) => {
      state.injectRoot(node, type);
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "doc",
    runner: (state, node) => {
      state.openNode("root");
      state.next(stripEdgeEmpties(node.content));
    },
  },
}));

/** Register after `commonmark` and `gfm` (see Key decisions). */
export const emptyParagraphEdgeSerializerPlugins: MilkdownPlugin[] = [
  docWithEdgeStrip,
  ...blockquoteSchema.extendSchema(edgeStripRule),
  ...extendListItemSchemaForTask.extendSchema(edgeStripRule),
];
