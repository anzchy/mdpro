/**
 * Purpose: parse exact inline <u> spans as editable marks and serialize them back.
 * @coordinates-with ../../components/Editor/MilkdownEditor.tsx
 * @coordinates-with ../../../tests/helpers/scriptedMilkdownRig.ts
 */
import { ConfigReady, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { $markSchema, $remark } from "@milkdown/kit/utils";
import { Mark, type MarkType } from "@milkdown/kit/prose/model";
import type { MarkdownNode, ParserState, SerializerState } from "@milkdown/kit/transformer";
import { defaultHandlers } from "mdast-util-to-markdown";

type InlineNode = { type: string; value?: string; children?: InlineNode[] };

/** Pair only exact sibling tags within a single inline container. */
export function pairUnderlineTags(nodes: InlineNode[]): void {
  for (const node of nodes) if (node.children) pairUnderlineTags(node.children);
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].type !== "html" || nodes[i].value !== "<u>") continue;
    const end = nodes.findIndex((node, index) => index > i && node.type === "html" && node.value === "</u>");
    if (end < 0) continue;
    const children = nodes.slice(i + 1, end);
    if (children.length === 0 || children.some((node) => node.type === "html" && node.value === "<u>")) continue;
    nodes.splice(i, end - i + 1, {
      type: "underline", children,
      outer: children.length === 1 && children[0].type === "strong",
    } as InlineNode);
  }
}

export const remarkUnderlinePlugin = $remark("remarkUnderline", () => () => (tree: InlineNode) => {
  if (tree.children) pairUnderlineTags(tree.children);
});

export const underlineMarkSchema = $markSchema("underline", () => ({
  attrs: { outer: { default: false } },
  parseDOM: [{ tag: "u" }],
  toDOM: () => ["u", { style: "text-decoration: underline" }, 0] as [string, Record<string, string>, number],
  parseMarkdown: {
    match: (node: MarkdownNode) => node.type === "underline",
    runner: (state: ParserState, node: MarkdownNode, markType: MarkType) => {
      state.openMark(markType, { outer: node.outer === true });
      if (Array.isArray(node.children)) state.next(node.children as MarkdownNode[]);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark: Mark) => mark.type.name === "underline",
    runner: (state: SerializerState, mark: Mark) => {
      state.withMark(mark, "underline", undefined, { outer: mark.attrs.outer });
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function underlineSerializerHandler(node: any, _parent: unknown, state: any, info: any): string {
  const tracker = state.createTracker(info);
  const exit = state.enter("underline");
  const value = state.containerPhrasing(node, tracker.current());
  exit();
  return `<u>${value}</u>`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function strongWithOuterUnderline(node: any, _parent: Parameters<typeof defaultHandlers.strong>[1], state: any, info: any): string {
  const child = node.children?.length === 1 ? node.children[0] : null;
  if (child?.type === "underline" && child.outer === true) {
    const inner = state.containerPhrasing(child, info);
    return `<u>**${inner}**</u>`;
  }
  return defaultHandlers.strong(node, _parent, state, info);
}
strongWithOuterUnderline.peek = defaultHandlers.strong.peek;

const remarkUnderlineStringify: MilkdownPlugin = (ctx: Ctx) => async () => {
  await ctx.wait(ConfigReady);
  const current = ctx.get(remarkStringifyOptionsCtx);
  ctx.set(remarkStringifyOptionsCtx, {
    ...current,
    handlers: {
      ...current.handlers,
      underline: underlineSerializerHandler,
      strong: strongWithOuterUnderline,
    } as typeof current.handlers,
  });
};

export const underlineMarkPlugin: MilkdownPlugin[] = [
  ...remarkUnderlinePlugin,
  underlineMarkSchema.mark,
  underlineMarkSchema.ctx,
  remarkUnderlineStringify,
];
