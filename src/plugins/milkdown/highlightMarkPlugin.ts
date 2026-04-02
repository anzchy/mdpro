/**
 * Purpose: Milkdown plugin that adds ==highlight== syntax to the WYSIWYG editor.
 *
 * Pipeline:
 *   1. remarkHighlightPlugin ($remark) — remark AST transformer.
 *      Walks text nodes and converts ==text== spans into
 *      { type: "highlight", children: [{ type: "text", value }] } mdast nodes.
 *
 *   2. highlightMarkSchema ($markSchema) — ProseMirror mark.
 *      Maps mdast "highlight" nodes ↔ <mark> DOM element ↔ ==text== markdown.
 *
 *   3. remarkHighlightStringify — MilkdownPlugin that injects a custom
 *      "highlight" handler into remarkStringifyOptionsCtx so the serialiser
 *      round-trips ==text== correctly (highlight node → ==text== in source).
 *
 * Key decisions:
 *   - mdast-util-find-and-replace (direct dep) handles AST traversal — no
 *     micromark syntax extension needed for this use-case.
 *   - pulldown-cmark 0.11 has no ENABLE_HIGHLIGHT; the Rust side uses
 *     preprocess_highlight() in markdown.rs instead.
 *   - The CodeMirror shortcut (highlightPlugin.ts) was updated to insert ==
 *     instead of raw <mark> HTML. Both shortcuts now emit the same syntax.
 *
 * @coordinates-with MilkdownEditor.tsx (plugin registration via .use(highlightMarkPlugin))
 * @coordinates-with highlightPlugin.ts (CodeMirror shortcut — must also use ==)
 * @coordinates-with exportService.ts (renderHighlightSyntaxInHtml for preview layer)
 */

import { ConfigReady, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { $markSchema, $remark } from "@milkdown/kit/utils";
import type { MarkType } from "@milkdown/kit/prose/model";
import { Mark } from "@milkdown/kit/prose/model";
import type { ParserState, SerializerState, MarkdownNode } from "@milkdown/kit/transformer";
import { findAndReplace } from "mdast-util-find-and-replace";

// Minimal mdast types used in this file — avoids a direct @types/mdast dependency.
type MdastRoot = { type: "root"; children: unknown[] };
type MdastPhrasingContent = { type: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// 1. Remark parse plugin — ==text== → mdast highlight node
// ---------------------------------------------------------------------------

/**
 * Exported for unit testing in isolation.
 * Returns a synthetic mdast highlight node or false if inner text is empty.
 */
export function remarkHighlightReplacer(
  _match: string,
  inner: string,
): MdastPhrasingContent | false {
  if (!inner) return false;
  return {
    type: "highlight",
    children: [{ type: "text", value: inner }],
  } as MdastPhrasingContent;
}

/** Exported for unit testing. */
export function remarkHighlightTransformer() {
  return (tree: MdastRoot) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // [^\n]+? (not [^=\n]+?) allows = inside highlighted content, e.g. ==a=b==.
    // The Rust pre-pass and JS DOM processor already handle this correctly;
    // the Milkdown regex was the only pipeline that rejected it.
    findAndReplace(tree as any, [[/==([^\n]+?)==/g, remarkHighlightReplacer as any]]);
  };
}

export const remarkHighlightPlugin = $remark(
  "remarkHighlight",
  () => remarkHighlightTransformer,
);

// ---------------------------------------------------------------------------
// 2. ProseMirror mark schema
// ---------------------------------------------------------------------------

export const highlightMarkSchema = $markSchema("highlight", () => ({
  parseDOM: [{ tag: "mark" }],
  toDOM: () => ["mark", 0] as [string, number],
  parseMarkdown: {
    match: (node: MarkdownNode) => node.type === "highlight",
    runner: (
      state: ParserState,
      node: MarkdownNode,
      markType: MarkType,
    ) => {
      state.openMark(markType);
      if (Array.isArray(node.children)) {
        state.next(node.children as MarkdownNode[]);
      }
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark: Mark) => mark.type.name === "highlight",
    runner: (state: SerializerState, mark: Mark) => {
      state.withMark(mark, "highlight");
    },
  },
}));

// ---------------------------------------------------------------------------
// 3. Stringify plugin — teach mdast-util-to-markdown to emit ==text==
// ---------------------------------------------------------------------------

/**
 * Serialize a highlight node back to ==text== markdown.
 *
 * Exported for unit testing in isolation.
 *
 * Known limitation: if the inner text ends with `=` the round-trip may
 * lose the trailing `=` because `/==([^\n]+?)==/g` will greedily absorb the
 * last `=` into the content boundary. This edge case is rare in practice.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function highlightSerializerHandler(node: any, _parent: unknown, state: any, info: any): string {
  const tracker = state.createTracker(info);
  const exit = state.enter("highlight");
  const value = state.containerPhrasing(node, {
    ...tracker.current(),
    before: "=",
    after: "=",
  });
  exit();
  return `==${value}==`;
}

const remarkHighlightStringify: MilkdownPlugin = (ctx: Ctx) => async () => {
  await ctx.wait(ConfigReady);
  const current = ctx.get(remarkStringifyOptionsCtx);
  ctx.set(remarkStringifyOptionsCtx, {
    ...current,
    // Cast to any: "highlight" is a custom node type outside Handlers' known keys
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handlers: {
      ...current.handlers,
      highlight: highlightSerializerHandler,
    } as typeof current.handlers,
  });
};

// ---------------------------------------------------------------------------
// 4. Composite export — everything MilkdownEditor needs via .use(highlightMarkPlugin)
// ---------------------------------------------------------------------------

/**
 * Use all pieces in one call:
 *   .use(highlightMarkPlugin)
 */
export const highlightMarkPlugin: MilkdownPlugin[] = [
  ...remarkHighlightPlugin,
  highlightMarkSchema.mark,
  highlightMarkSchema.ctx,
  remarkHighlightStringify,
];
