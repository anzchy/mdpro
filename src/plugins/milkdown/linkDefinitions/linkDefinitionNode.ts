/**
 * @module linkDefinitions/linkDefinitionNode
 * Purpose: The `link_definition` block of ADR-0094 (D194): a link reference
 * definition kept in the WYSIWYG document and written back verbatim.
 *
 * Pipeline: read — an mdast `definition` (stamped with `raw` by
 * `resolveReferences.ts`) becomes a block atom with attrs identifier / label / url /
 * title / raw. Write — the node becomes an mdast `mdproLinkDefinition` whose `value`
 * is `raw`; `linkDefinitionStringify` registers that type's remark-stringify handler
 * (returns `value` unescaped) and a `join` rule. The containers' own handlers add
 * their prefixes (`> `, the item indent) to every line, as for any block.
 *
 * Key decisions:
 *   - A custom mdast type, not `definition`: the stock `definition` handler would
 *     re-spell the URL and title; ours writes the source bytes.
 *   - Join: two consecutive definitions are tight (one newline, ADR-0094 Decision 2);
 *     any other boundary next to a definition is one blank line, so a definition is
 *     never written as a paragraph continuation inside a tight list.
 *   - The stringify options are set before `init` builds remark: the plugin adds its
 *     own timer to `initTimerCtx`, so the ordering does not hang on microtask luck.
 *   - Display (i): a non-editable `div[data-type="link-definition"]` whose text is
 *     `raw`, styled muted and monospace by `linkDefinitions.css`; `atom` and
 *     `selectable`, so it is deleted and undone as a node.
 *
 * @coordinates-with src/plugins/milkdown/linkDefinitions/resolveReferences.ts — the reader
 * @coordinates-with src/plugins/milkdown/emptyParagraph/blankLineGaps.ts — counts gaps next to it
 */
import "./linkDefinitions.css";
import { ConfigReady, initTimerCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { createTimer } from "@milkdown/kit/ctx";
import { $nodeSchema } from "@milkdown/kit/utils";

/** The ProseMirror node name (ADR-0094). */
export const LINK_DEFINITION_NODE = "link_definition";
/** The mdast type the writer emits, handled by `linkDefinitionStringify`. */
export const LINK_DEFINITION_MDAST = "mdproLinkDefinition";
const DOM_TYPE = "link-definition";

/** Our own unist shape for the join rule: only `type` is read. */
interface Typed {
  type: string;
}

/** The text a definition is written as when no source slice was stamped. */
export function fallbackRaw(label: string, url: string, title: string | null): string {
  const target = /[\s<>]/.test(url) || url === "" ? `<${url}>` : url;
  const tail = title === null ? "" : ` "${title.replace(/"/g, '\\"')}"`;
  return `[${label}]: ${target}${tail}`;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

export const linkDefinitionSchema = $nodeSchema(LINK_DEFINITION_NODE, () => ({
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  defining: true,
  attrs: {
    identifier: { default: "" },
    label: { default: "" },
    url: { default: "" },
    title: { default: null },
    raw: { default: "" },
  },
  toDOM: (node) => [
    "div",
    {
      "data-type": DOM_TYPE,
      "data-identifier": node.attrs.identifier,
      "data-label": node.attrs.label,
      "data-url": node.attrs.url,
      ...(node.attrs.title === null ? {} : { "data-title": node.attrs.title }),
      contenteditable: "false",
      class: "mdpro-link-definition",
    },
    node.attrs.raw,
  ],
  parseDOM: [
    {
      tag: `div[data-type="${DOM_TYPE}"]`,
      getAttrs: (dom) => {
        const el = dom as HTMLElement;
        return {
          identifier: el.dataset.identifier ?? "",
          label: el.dataset.label ?? "",
          url: el.dataset.url ?? "",
          title: el.dataset.title ?? null,
          raw: el.textContent ?? "",
        };
      },
    },
  ],
  parseMarkdown: {
    match: ({ type }) => type === "definition",
    runner: (state, node, type) => {
      const label = str(node.label) || str(node.identifier);
      const url = str(node.url);
      const title = typeof node.title === "string" ? node.title : null;
      const raw = typeof node.raw === "string" ? node.raw : fallbackRaw(label, url, title);
      state.addNode(type, { identifier: str(node.identifier), label, url, title, raw });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === LINK_DEFINITION_NODE,
    runner: (state, node) => {
      state.addNode(LINK_DEFINITION_MDAST, undefined, String(node.attrs.raw));
    },
  },
}));

/** remark-stringify handler: the raw source text, never escaped. */
function linkDefinitionHandler(node: { value?: unknown }): string {
  return typeof node.value === "string" ? node.value : "";
}

/** Join rule (see Key decisions): 0 = one newline, 1 = one blank line. */
export function linkDefinitionJoin(left: Typed, right: Typed): number | undefined {
  const l = left.type === LINK_DEFINITION_MDAST;
  const r = right.type === LINK_DEFINITION_MDAST;
  if (l && r) return 0;
  if (l || r) return 1;
  return undefined;
}

const LinkDefinitionStringifyReady = createTimer("LinkDefinitionStringifyReady");

/** Registers the handler and join rule in remark-stringify's options. */
export const linkDefinitionStringify: MilkdownPlugin = (ctx) => {
  ctx.record(LinkDefinitionStringifyReady);
  ctx.update(initTimerCtx, (timers) => timers.concat(LinkDefinitionStringifyReady));
  return async () => {
    await ctx.wait(ConfigReady);
    const current = ctx.get(remarkStringifyOptionsCtx);
    ctx.set(remarkStringifyOptionsCtx, {
      ...current,
      handlers: {
        ...current.handlers,
        [LINK_DEFINITION_MDAST]: linkDefinitionHandler,
      } as typeof current.handlers,
      join: [...(current.join ?? []), linkDefinitionJoin] as typeof current.join,
    });
    ctx.done(LinkDefinitionStringifyReady);
    return () => {
      ctx.clearTimer(LinkDefinitionStringifyReady);
    };
  };
};
