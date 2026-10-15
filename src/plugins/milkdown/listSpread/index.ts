/**
 * @module listSpread
 * Purpose: The list schemas' re-registration, for three write-back defects.
 *   - D195: lists are written with the tight/loose spacing they were read with.
 *     preset-commonmark@7.18.0 stores a list's `spread` attr as the string "true" /
 *     "false" when it parses Markdown (and as a boolean when it parses DOM); its
 *     `bullet_list` and plain `list_item` serializers hand that value to mdast as is, and
 *     mdast-util-to-markdown honours only a boolean `spread` (`join.js`), so a tight list
 *     gained blank lines between its items on the first save after an edit.
 *   - D204: a list keeps the marker it was read with (`-` `+` `*`, or the ordered
 *     delimiter `.` `)`), held in a `marker` / `delimiter` attr.
 *   - D208: an ordered list keeps the number it started at, held in the preset's
 *     `order` attr, which the preset never read from Markdown and wrote as `start: 1`.
 *
 * Pipeline: read — `remarkListMarker` records `mdproMarker` on the mdast list, and the
 * parse runners copy it (and `start`) into attrs; write — the `toMarkdown` runners coerce
 * `spread` to a boolean (`isSpread`) and pass `start` and `mdproMarker` on the mdast
 * list, which `listMarker`'s wrapped `list` handler writes. The attrs also round-trip
 * through the DOM as `data-marker` / `data-delimiter` / `data-order` (and `start`),
 * so a copy inside the editor keeps them.
 *
 * Key decisions:
 *   - Spread is fixed on write, where the string meets the boolean-only writer: the
 *     preset's ordered-list and task-item serializers already compare `=== "true"`, and
 *     `syncListOrderPlugin` sets `spread: "true"` itself, so the string is the preset's
 *     convention, not a stray value. The parse runners keep the preset's spread values.
 *   - `list_item` is registered once, by emptyParagraph/edgeSerializer.ts, as
 *     `edgeStripRule(listItemSpreadRule(gfm task item))`: a schema id registered
 *     later replaces the earlier spec, so two registrations would drop one rule.
 *   - A list with no recorded marker (built in the editor, pasted as HTML) is written
 *     with the default from `listMarker` (`-`, `.`).
 *   - D226: an ordered list not starting at 1 also carries `start` in the DOM, so the
 *     editor numbers it from there (the preset's own `toDOM` spreads a number and emits
 *     nothing). `data-order` stays, and the wrapped parse rule still reads it first. Both carry
 *     `startOf(order)`, the number the list is saved with, so what is shown is what is written.
 *
 * @coordinates-with src/plugins/milkdown/emptyParagraph/edgeSerializer.ts — registers list_item
 * @coordinates-with src/plugins/milkdown/commonmarkPreset.ts — appends `listSpreadPlugins`
 * @coordinates-with src/plugins/milkdown/listSpread/remarkListMarker.ts — the marker reader
 * @coordinates-with src/plugins/milkdown/listSpread/listMarker.ts — the marker writer
 */
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { bulletListSchema, orderedListSchema } from "@milkdown/kit/preset/commonmark";
import type { DOMOutputSpec, TagParseRule } from "@milkdown/kit/prose/model";
import type { GetNodeSchema } from "@milkdown/kit/utils";
import type { JSONRecord } from "@milkdown/kit/transformer";
import { listMarkerStringify, MAX_ORDERED_NUMBER } from "./listMarker";
import { BULLET_MARKERS, ORDERED_DELIMITERS, remarkListMarkerPlugin } from "./remarkListMarker";

/** A `spread` attr as mdast wants it: only `true` and `"true"` are loose. */
export function isSpread(value: unknown): boolean {
  return value === true || value === "true";
}

/** A string attr read from a DOM dataset value, or null when it is not one of `allowed`. */
function datasetMarker(value: string | undefined, allowed: ReadonlySet<string>): string | null {
  return value !== undefined && allowed.has(value) ? value : null;
}

/** The marker an mdast list carries from `remarkListMarker`, or null. */
function mdastMarker(node: { mdproMarker?: unknown }, allowed: ReadonlySet<string>): string | null {
  return typeof node.mdproMarker === "string" && allowed.has(node.mdproMarker) ? node.mdproMarker : null;
}

/**
 * A start number for the `order` attr: an integer CommonMark can write (0 to nine digits),
 * else 1. A larger one only arrives through the DOM (a pasted `<ol start>`).
 */
function startOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_ORDERED_NUMBER
    ? value
    : 1;
}

/**
 * `extendSchema` handler for `bullet_list` / `ordered_list`: the `marker` / `delimiter`
 * attr (D204) and the `order` read (D208) on parse and DOM, and `spread` as a boolean,
 * `start` and `mdproMarker` on write.
 */
function listSpreadRule(ordered: boolean) {
  const attr = ordered ? "delimiter" : "marker";
  const allowed = ordered ? ORDERED_DELIMITERS : BULLET_MARKERS;
  return (prev: GetNodeSchema): GetNodeSchema =>
    (ctx) => {
      const base = prev(ctx);
      const baseParse = base.parseDOM?.[0];
      const baseToDOM = base.toDOM;
      return {
        ...base,
        attrs: { ...base.attrs, [attr]: { default: null } },
        parseDOM: baseParse
          ? [
              {
                ...baseParse,
                getAttrs: (dom: HTMLElement) => {
                  const got = (baseParse as TagParseRule).getAttrs?.(dom);
                  if (got === false) return false;
                  const own = got && typeof got === "object" ? got : {};
                  const data = dom.dataset;
                  const order = ordered && data.order !== undefined ? { order: startOf(Number(data.order)) } : {};
                  return { ...own, ...order, [attr]: datasetMarker(data[attr], allowed) };
                },
              },
              ...(base.parseDOM ?? []).slice(1),
            ] as TagParseRule[]
          : base.parseDOM,
        toDOM: (node) => {
          const out = baseToDOM ? baseToDOM(node) : null;
          if (out === null) return ["div", 0];
          if (!Array.isArray(out) || typeof out[1] !== "object" || out[1] === null || Array.isArray(out[1])) return out;
          const extra: Record<string, string> = {};
          if (node.attrs[attr] != null) extra[`data-${attr}`] = String(node.attrs[attr]);
          // The start the list is saved with (D226-WI-2): a pasted start CommonMark cannot write,
          // or one that is not a number, shows and saves as 1, so neither attr carries it.
          const order = ordered ? startOf(node.attrs.order) : 1;
          if (order !== 1) {
            extra["data-order"] = String(order);
            extra.start = String(order); // D226: the engine numbers from it
          }
          return [out[0], { ...(out[1] as Record<string, unknown>), ...extra }, ...out.slice(2)] as DOMOutputSpec;
        },
        parseMarkdown: {
          ...base.parseMarkdown,
          runner: (state, node, type) => {
            const spread = node.spread != null ? `${node.spread}` : ordered ? "true" : "false";
            const marker = mdastMarker(node as { mdproMarker?: unknown }, allowed);
            const attrs: Record<string, unknown> = { spread, [attr]: marker };
            if (ordered) attrs.order = startOf(node.start);
            state.openNode(type, attrs).next(node.children).closeNode();
          },
        },
        toMarkdown: {
          ...base.toMarkdown,
          runner: (state, node) => {
            const spread = isSpread(node.attrs.spread);
            const props: JSONRecord = ordered
              ? { ordered, start: startOf(node.attrs.order), spread }
              : { ordered, spread };
            if (node.attrs[attr] != null) props.mdproMarker = String(node.attrs[attr]);
            state.openNode("list", undefined, props).next(node.content).closeNode();
          },
        },
      };
    };
}

/**
 * `extendSchema` handler for preset-gfm's `list_item`: write `spread` as a boolean, and a
 * task item's label, list type and checkbox as the preset does.
 */
export function listItemSpreadRule(prev: GetNodeSchema): GetNodeSchema {
  return (ctx) => {
    const base = prev(ctx);
    return {
      ...base,
      toMarkdown: {
        ...base.toMarkdown,
        runner: (state, node) => {
          const { label, listType, checked } = node.attrs;
          const spread = isSpread(node.attrs.spread);
          const props: JSONRecord =
            checked == null ? { spread } : { label, listType, spread, checked };
          state.openNode("listItem", undefined, props).next(node.content).closeNode();
        },
      },
    };
  };
}

/**
 * The two list schemas (spread, marker, start), the marker reader and the marker writer.
 * Registered after `commonmark`'s own.
 */
export const listSpreadPlugins: MilkdownPlugin[] = [
  ...bulletListSchema.extendSchema(listSpreadRule(false)),
  ...orderedListSchema.extendSchema(listSpreadRule(true)),
  ...remarkListMarkerPlugin,
  listMarkerStringify,
];
