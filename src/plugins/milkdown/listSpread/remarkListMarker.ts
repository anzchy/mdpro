/**
 * @module listSpread/remarkListMarker
 * Purpose: The reader half of D204. A remark transformer that records, on every mdast
 * `list` node, the marker the source wrote it with: `-` `+` `*` for a bullet list, the
 * delimiter `.` or `)` for an ordered one. It is stored as `mdproMarker`, which the list
 * schemas' parse runners copy into the `marker` / `delimiter` attr.
 *
 * Pipeline: Milkdown's parser calls `remark.runSync(remark.parse(md), md)`, so the
 * transformer reads the source from `file.value`, as preset-commonmark's own
 * `remarkMarker` does for emphasis and strong. A list's first item starts at its marker
 * (inside a blockquote too), and in CommonMark a change of marker starts a new list, so
 * the first item's marker is the whole list's.
 *
 * @coordinates-with src/plugins/milkdown/listSpread/index.ts — copies `mdproMarker` into attrs
 * @coordinates-with src/plugins/milkdown/listSpread/listMarker.ts — writes it back
 */
import { $remark } from "@milkdown/kit/utils";

/** The mdast shape this transformer touches; positions are unist offsets. */
interface MdNode {
  type: string;
  ordered?: boolean | null;
  mdproMarker?: string;
  children?: MdNode[];
  position?: { start?: { offset?: number } };
}

export const BULLET_MARKERS: ReadonlySet<string> = new Set(["-", "+", "*"]);
export const ORDERED_DELIMITERS: ReadonlySet<string> = new Set([".", ")"]);
/** An ordered list marker at a given offset: 1–9 digits (CommonMark), then the delimiter. */
const ORDERED_MARKER = /\d{1,9}([.)])/y;

/** The marker a list was written with, read at its first item's start, or null. */
export function sourceMarker(list: MdNode, source: string): string | null {
  const offset = list.children?.[0]?.position?.start?.offset;
  if (typeof offset !== "number") return null;
  if (!list.ordered) {
    const ch = source.charAt(offset);
    return BULLET_MARKERS.has(ch) ? ch : null;
  }
  ORDERED_MARKER.lastIndex = offset;
  const match = ORDERED_MARKER.exec(source);
  return match ? match[1] : null;
}

/** Record `mdproMarker` on every list in the tree parsed from `source`. */
export function applyListMarkers(node: MdNode, source: string): void {
  if (node.type === "list") {
    const marker = sourceMarker(node, source);
    if (marker) node.mdproMarker = marker;
  }
  node.children?.forEach((child) => applyListMarkers(child, source));
}

/** The `$remark` plugin. */
export const remarkListMarkerPlugin = $remark(
  "mdpro-list-marker",
  () => () => (tree: unknown, file: { value?: unknown } | undefined) => {
    const value = file?.value;
    const source =
      typeof value === "string" ? value : value instanceof Uint8Array ? new TextDecoder().decode(value) : null;
    if (source !== null) applyListMarkers(tree as MdNode, source);
  },
);
