/**
 * @module tableEdits
 * Purpose: Public barrel for the source-mode pure table edit
 * functions (Phase 2 WI-2.4). Split into `edits.ts` (the 14
 * per-action functions) and `applyEdit.ts` (the action-id
 * dispatcher) per rule 50 (file size guideline).
 *
 * @coordinates-with src/plugins/codemirror/sourceTableContextMenu.ts
 * @coordinates-with src/plugins/milkdown/table/actionDescriptors.ts
 */

export {
  deleteColumn,
  deleteRow,
  deleteTable,
  insertColumnAfter,
  insertColumnBefore,
  insertRowAfter,
  insertRowBefore,
  moveColumnLeft,
  moveColumnRight,
  moveRowDown,
  moveRowUp,
  setAlignment,
  type EditResult,
} from "./edits";
export { applyEdit } from "./applyEdit";
