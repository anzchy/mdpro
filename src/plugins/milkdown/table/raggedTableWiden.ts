/**
 * @module table/raggedTableWiden
 * Purpose: Parse-time `$remark` transformer that makes every GFM table rectangular
 * before Milkdown builds the ProseMirror doc (ADR-0067 Decisions 1 and 2, D64 WI-2).
 * remark-gfm keeps overflow cells and short rows, and a ragged PM table is what
 * prosemirror-tables' `fixTables` later "repairs" by padding at the row START.
 *
 * Pipeline: markdown → remark.parse (remark-gfm builds ragged `table` nodes) →
 * remark.runSync → `widenMdastTables` (this file) → Milkdown's ParserState → PM doc.
 * Every Markdown entry point goes through here: initial load, Source → WYSIWYG,
 * remount, MCP `replaceAll`, and the MCP write / insert rebuilds. HTML paste does
 * not (WI-3). Milkdown's serializer never calls `runSync`, so this runs on parse only.
 *
 * Key decisions:
 *   - The widening rule is `widenRows` from `src/utils/tableWiden.ts`, shared with
 *     the source-side `widenTable`; it is not copied. Widest row, a blank overflow
 *     cell counts, padding at the row END (header included) with empty
 *     `tableCell`s, so every existing cell keeps its column index.
 *   - `table.align` is extended with explicit `null`. ProseMirror substitutes an
 *     attr default only for `undefined`, so `null` keeps an added column at `---`
 *     instead of the schema default `left` (`:---`).
 *   - Every table is widened, at any depth (blockquotes, list items). The walk is
 *     an explicit stack, not recursion, and does not descend into a table.
 *   - It edits the mdast, never the editor: no transaction is dispatched, so loading
 *     a ragged file neither dirties it nor writes the store (edit-sync's baseline is
 *     the serialization of this already-widened doc).
 *   - No logging: a pure parse transform with no failure path and no runtime event
 *     worth a log line (rule 20); a per-load log would fire on every keystroke-free open.
 *   - The `$remark` factory returns an ATTACHER that returns the transformer;
 *     returning the transformer directly makes unified call it as an attacher, and
 *     the widening silently never runs.
 *
 * @coordinates-with src/utils/tableWiden.ts — `widenRows`, the shared rule
 * @coordinates-with src/plugins/milkdown/table/parityPlugins.ts — exports it with the
 *   empty-cell serializer as `tableParityPlugins`
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx — `.use`s that list after gfm
 */
import { $remark } from "@milkdown/kit/utils";
import type { ColumnAlignment } from "../../../utils/tableParser";
import { widenRows } from "../../../utils/tableWiden";

// Minimal mdast shapes — avoids a direct @types/mdast dependency (as highlightMarkPlugin.ts).
interface MdastNode {
  type: string;
  children?: MdastNode[];
}
interface MdastTable extends MdastNode {
  type: "table";
  align?: ColumnAlignment[] | null;
  children: MdastNode[];
}

const isTable = (node: MdastNode): node is MdastTable =>
  node.type === "table" && Array.isArray(node.children);

function widenOne(table: MdastTable): void {
  const rows = table.children.map((row) => {
    if (!Array.isArray(row.children)) row.children = [];
    return row.children;
  });
  const { alignments } = widenRows(rows, table.align ?? [], () => ({
    type: "tableCell",
    children: [],
  }));
  table.align = alignments;
}

/**
 * Widen every GFM table in `tree` in place: rectangular at its widest row, padded at
 * the row end with empty `tableCell`s, `align` extended with explicit `null`.
 * Idempotent; a rectangular table is left with equal content.
 */
export function widenMdastTables(tree: unknown): void {
  const stack: MdastNode[] = [tree as MdastNode];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isTable(node)) {
      widenOne(node);
      continue;
    }
    // A loop, not push(...children): a spread over a huge root overflows the stack.
    if (Array.isArray(node.children)) for (const child of node.children) stack.push(child);
  }
}

/** The unified attacher: called once per processor, returns the transformer. */
function remarkTableWidenAttacher() {
  return (tree: unknown) => widenMdastTables(tree);
}

/** Register after `gfm` (via `tableParityPlugins`). */
export const remarkTableWidenPlugin = $remark("remarkTableWiden", () => remarkTableWidenAttacher);
