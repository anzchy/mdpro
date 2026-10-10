/**
 * @module table/parityPlugins
 * Purpose: The one list of Milkdown plugins that keeps WYSIWYG tables in parity with
 * the source-side widener (`src/utils/tableWiden.ts`, ADR-0063 / ADR-0067).
 * MilkdownEditor.tsx and the tests both build their editor from this export, so the
 * tests cover exactly what the app registers.
 *
 * Pipeline: parse — `remarkTableWidenPlugin` widens ragged mdast tables before the
 * PM doc exists (WI-2); serialize — `tableEmptyCellSerializerPlugin` writes an empty
 * cell blank, never `<br />` (WI-1); paste — `tablePasteNormalizePlugin` end-pads
 * ragged tables in an HTML paste, which bypasses remark (WI-3). Together a widened
 * table serializes byte-identically to `tableWiden`'s output.
 *
 * Key decisions:
 *   - Must be `.use`d after `gfm`: the serializer rule re-registers gfm's cell
 *     schemas and replaces them only if it comes later.
 *
 * @coordinates-with src/plugins/milkdown/table/raggedTableWiden.ts
 * @coordinates-with src/plugins/milkdown/table/emptyCellSerializer.ts
 * @coordinates-with src/plugins/milkdown/table/pasteTableNormalize.ts
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx — `.use(tableParityPlugins)` after gfm
 */
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { tableEmptyCellSerializerPlugin } from "./emptyCellSerializer";
import { tablePasteNormalizePlugin } from "./pasteTableNormalize";
import { remarkTableWidenPlugin } from "./raggedTableWiden";

export const tableParityPlugins: MilkdownPlugin[] = [
  ...remarkTableWidenPlugin,
  ...tableEmptyCellSerializerPlugin,
  tablePasteNormalizePlugin,
];
