/**
 * @module table/cellAlignmentDom
 * Purpose: DOM rules for a GFM table cell's `alignment` that keep "no alignment"
 * (`null`, a `---` delimiter) distinct from `left` (`:--`) through HTML, so an
 * unaligned table pasted or copied in WYSIWYG stays unaligned (D99).
 *
 * Pipeline: parse — an HTML paste skips remark, so a cell's alignment comes from
 * the cell schema's `parseDOM`; this rule reads `style="text-align: …"`, then the
 * `align` attribute, and otherwise sets `null`. Render / copy — `toDOM` writes
 * `style="text-align: …"` only for a set alignment, so the clipboard HTML of an
 * unaligned cell carries none and parses back as `null`. Markdown parse and
 * serialize are untouched: those runners set and read `alignment` directly.
 *
 * Key decisions:
 *   - preset-gfm's cell attribute reads a missing `text-align` as `'left'` and
 *     writes `null` as `text-align: left`, so every HTML paste — including an
 *     in-app copy of a `| --- |` table — came back as `| :- |`. Overriding the
 *     cell schema's DOM rules is the narrowest point that still sees the DOM;
 *     by `transformPasted` the parsed node can no longer tell `left` from absent.
 *   - `getAttrs` returns `alignment: null` explicitly: prosemirror-tables'
 *     `getCellAttrs` drops a `null` getter result, which would let the schema
 *     default `'left'` back in. The default itself is left alone, so a cell
 *     created without attrs (insert table, MCP actions) is unchanged.
 *   - Only `left` / `center` / `right` are read; any other value (`start`,
 *     `justify`, …) has no GFM delimiter and reads as no alignment.
 *   - An explicit `text-align: left` still means left. A clipboard copied from a
 *     build before this rule writes that for unaligned cells too, so it still
 *     pastes as `:-`; only copies made with this rule round-trip `null`.
 *   - Visual: an unaligned cell loses its inline style, and MilkdownEditor.css's
 *     `th, td { text-align: left }` default renders it as before.
 *   - Must be composed with the empty-cell serializer rule in one `extendSchema`
 *     (`parityPlugins.ts`): each `extendSchema` starts from the preset's spec, so a
 *     second, separate extension would replace the first.
 *
 * @coordinates-with src/plugins/milkdown/table/parityPlugins.ts — composes this rule into the registered cell schemas
 * @coordinates-with src/plugins/milkdown/table/emptyCellSerializer.ts — the other rule on the same schemas
 * @coordinates-with src/components/Editor/MilkdownEditor.css — the `th, td` left default for unaligned cells
 */
import type { DOMOutputSpec, Node as PmNode, TagParseRule } from "@milkdown/kit/prose/model";
import type { GetNodeSchema } from "@milkdown/kit/utils";

export type CellAlignment = "left" | "center" | "right";

const ALIGNMENTS: readonly string[] = ["left", "center", "right"];

function asAlignment(value: string | null | undefined): CellAlignment | null {
  const v = value?.trim().toLowerCase() ?? "";
  return ALIGNMENTS.includes(v) ? (v as CellAlignment) : null;
}

/**
 * A cell element's GFM alignment: inline `text-align` first, then the `align`
 * attribute; `null` when neither names left, center or right.
 */
export function alignmentFromDom(dom: HTMLElement): CellAlignment | null {
  return asAlignment(dom.style.textAlign) ?? asAlignment(dom.getAttribute("align"));
}

function withDomAlignment(rule: TagParseRule): TagParseRule {
  const baseGetAttrs = rule.getAttrs;
  return {
    ...rule,
    getAttrs: (dom: HTMLElement) => {
      const attrs = baseGetAttrs ? baseGetAttrs(dom) : {};
      if (!attrs) return attrs;
      return { ...attrs, alignment: alignmentFromDom(dom) };
    },
  };
}

/** Drop the `style` attribute the preset writes for a `null` alignment. */
function withoutNullAlignmentStyle(spec: DOMOutputSpec, node: PmNode): DOMOutputSpec {
  if (node.attrs.alignment != null || !Array.isArray(spec)) return spec;
  const [tag, attrs, ...rest] = spec as unknown[];
  if (typeof attrs !== "object" || attrs === null || Array.isArray(attrs) || !("style" in attrs)) {
    return spec;
  }
  const { style: _style, ...kept } = attrs as Record<string, unknown>;
  return [tag, kept, ...rest] as unknown as DOMOutputSpec;
}

/**
 * `extendSchema` handler for `table_cell` / `table_header`: replaces the
 * alignment half of the cell's DOM rules and keeps every other field of `prev`.
 */
export function cellAlignmentDomRule(prev: GetNodeSchema): GetNodeSchema {
  return (ctx) => {
    const base = prev(ctx);
    const baseToDOM = base.toDOM;
    return {
      ...base,
      parseDOM: base.parseDOM?.map(withDomAlignment),
      toDOM: baseToDOM ? (node) => withoutNullAlignmentStyle(baseToDOM(node), node) : undefined,
    };
  };
}
