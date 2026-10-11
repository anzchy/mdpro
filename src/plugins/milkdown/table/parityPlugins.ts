/**
 * @module table/parityPlugins
 * Purpose: The one list of Milkdown plugins that keeps WYSIWYG tables in parity with
 * the source-side widener (`src/utils/tableWiden.ts`, ADR-0063 / ADR-0067).
 * MilkdownEditor.tsx and the tests both build their editor from this export, so the
 * tests cover exactly what the app registers.
 *
 * Pipeline: parse — `remarkTableWidenPlugin` widens ragged mdast tables before the
 * PM doc exists (WI-2); cell schemas — one extension per cell schema composes
 * `emptyCellRule` (serialize an empty cell blank, never `<br />`, WI-1) with
 * `cellAlignmentDomRule` (HTML keeps "no alignment" apart from `left`, D99);
 * paste — `tablePasteNormalizePlugin` end-pads ragged tables in an HTML paste,
 * which bypasses remark (WI-3); edit —
 * `tableHeaderRepairPlugin` refills a header row a deletion or drop left with no
 * cells, before `fixTables` runs (D103 / D100). Together a widened table serializes
 * byte-identically to `tableWiden`'s output, and no edit leaves a table the
 * serializer cannot write.
 *
 * Key decisions:
 *   - Must be `.use`d after `gfm`: the cell-schema extension re-registers gfm's
 *     cell schemas and replaces them only if it comes later.
 *   - Both cell rules go through a single `extendSchema` per schema: each
 *     extension starts from the preset's spec, so two separate ones would not
 *     compose — the later would silently drop the earlier.
 *   - The header repair does not depend on its place in this list: it puts itself
 *     at the front of `prosePluginsCtx`, ahead of gfm's `tableEditing`.
 *
 * @coordinates-with src/plugins/milkdown/table/raggedTableWiden.ts
 * @coordinates-with src/plugins/milkdown/table/emptyCellSerializer.ts
 * @coordinates-with src/plugins/milkdown/table/cellAlignmentDom.ts
 * @coordinates-with src/plugins/milkdown/table/pasteTableNormalize.ts
 * @coordinates-with src/plugins/milkdown/table/emptyHeaderRowRepair.ts
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx — `.use(tableParityPlugins)` after gfm
 */
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { tableCellSchema, tableHeaderSchema } from "@milkdown/kit/preset/gfm";
import { cellAlignmentDomRule } from "./cellAlignmentDom";
import { emptyCellRule } from "./emptyCellSerializer";
import { tableHeaderRepairPlugin } from "./emptyHeaderRowRepair";
import { tablePasteNormalizePlugin } from "./pasteTableNormalize";
import { remarkTableWidenPlugin } from "./raggedTableWiden";

/** gfm's two cell schemas with both mdpro cell rules, each in one extension. */
const tableCellSchemaPlugins: MilkdownPlugin[] = [
  ...tableCellSchema.extendSchema((prev) => cellAlignmentDomRule(emptyCellRule(prev))),
  ...tableHeaderSchema.extendSchema((prev) => cellAlignmentDomRule(emptyCellRule(prev))),
];

export const tableParityPlugins: MilkdownPlugin[] = [
  ...remarkTableWidenPlugin,
  ...tableCellSchemaPlugins,
  tablePasteNormalizePlugin,
  tableHeaderRepairPlugin,
];
