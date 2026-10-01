/**
 * @module sourceTableExtensions
 * Purpose: the single place the Source-mode table extensions are assembled,
 * so they can be withheld together for a document whose Source table verdict
 * is "withheld" (ADR-0022; plan-20260922-113723 WI-4).
 *
 * Returns, in this order, which must not change (X5 pins `tabKeymap` at index 1):
 *   [tableDetectionExtension(), tabKeymap, sourceTableCellHighlightExtension(),
 *    tableColumnCountLinter()]
 * and `[]` when withheld — all four or none.
 * Array order only ranks extensions of equal precedence. The Tab keymap's
 * precedence over @uiw/react-codemirror's default `indentWithTab` comes from
 * the `Prec.high` Editor wraps around `tabKeymap` (D40), not from this order.
 *
 * Key decisions:
 * - **Withhold by removal, not by gating inside the field.** A field that
 *   stays installed but returns null would still be a place a later consumer
 *   could re-enable parsing; removing it means `getTableContext` is null and
 *   no per-selection parse runs.
 * - **`tabKeymap` is injected**, so Editor keeps passing its identity-stable
 *   memoized keymap and the helper stays pure.
 * - The context menu and App's table shortcut are not extensions; they gate
 *   on the same verdict separately (WI-5).
 *
 * @coordinates-with src/components/Editor/Editor.tsx — the only caller.
 * @coordinates-with src/hooks/useSourceTablesWithheld.ts — supplies `withheld`.
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/plugins/codemirror/sourceTableCellHighlight.ts
 * @coordinates-with src/plugins/codemirror/lintTableColumnCount.ts
 */
import type { Extension } from "@codemirror/state";
import { tableDetectionExtension } from "./sourceTableDetection";
import { sourceTableCellHighlightExtension } from "./sourceTableCellHighlight";
import { tableColumnCountLinter } from "./lintTableColumnCount";

export interface SourceTableExtensionsOptions {
  /** True when the active document's Source table verdict is "withheld". */
  withheld: boolean;
  /** The Source table Tab/Shift-Tab keymap extension, installed second. */
  tabKeymap: Extension;
}

/** The four Source table extensions in their fixed order, or `[]` when withheld. */
export function sourceTableExtensions({
  withheld,
  tabKeymap,
}: SourceTableExtensionsOptions): Extension[] {
  if (withheld) return [];
  return [
    tableDetectionExtension(),
    tabKeymap,
    sourceTableCellHighlightExtension(),
    tableColumnCountLinter(),
  ];
}
