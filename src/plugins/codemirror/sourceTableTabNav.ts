/**
 * @module sourceTableTabNav
 * Purpose: Tab / Shift-Tab cell navigation in source mode (Phase 2
 * WI-2.3; D41, ADR-0046). Each press has exactly one outcome, decided by
 * `sourceTableTabOwnership.ts#classifyTabPress`:
 *   - Fall through (return false) when no line of interest is a table line:
 *     prose, fenced code, the line after a table, a withheld document. The
 *     editor's default indent runs (which is also code-block Tab, d170f9c).
 *   - Swallow (return true, change nothing, log `ui.table.tab_swallowed`)
 *     when the press touches a table but cannot navigate. Reasons, first
 *     match wins: multi-table > mixed-selection > delimiter-row >
 *     guard-refused (`tableWriteGuard`, WI-C0) > first-cell (Shift-Tab).
 *     Before D41 these fell through and indented table text.
 *   - Navigate by OFFSET ORDER from the main head, collapsing to one cursor:
 *     Tab → `min{cell.start > head}`; Shift-Tab → start of
 *     `max{cell.end < head}`. A caret at a cell end or in a zero-width cell
 *     therefore still moves (`findCell`'s half-open interval lost it).
 *   - Tab with no later cell appends EXACTLY one blank row at `model.end`
 *     (`"\n|" + "  |" × colCount`, no trailing newline), in one
 *     transaction, cursor in its first cell.
 *
 * Key decisions:
 *   - Each keypress materialises its own `TableModel` (ADR-0043 D5) with
 *     one `parseTableAtLine` on the head's REAL line, over one
 *     `linesFromText` adapter — never a copy of the whole document. The
 *     detection field's value is not read; only its presence gates.
 *   - Shape reasons are decided before the guard, so the guard's raw copy
 *     is never paid for a press that is swallowed on shape.
 *
 * @coordinates-with src/plugins/codemirror/sourceTableTabOwnership.ts
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts
 * @coordinates-with src/plugins/codemirror/textLineSource.ts
 * @coordinates-with src/utils/tableParser/parse.ts
 * @coordinates-with src/utils/tableWriteGuard.ts
 */

import type { Command, EditorView, KeyBinding } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type { TableModel } from "../../utils/tableParser";
import { guardTableWrite } from "../../utils/tableWriteGuard";
import { classifyTabPress, logTabSwallow, type TabSwallowReason } from "./sourceTableTabOwnership";

/**
 * The model this press may navigate on, or `"fall"`; logs and reports
 * `"swallowed"` for every swallow reason except `first-cell`, which needs
 * the direction and is decided by the caller.
 */
function modelForPress(view: EditorView, key: "Tab" | "Shift-Tab"): TableModel | "fall" | "swallowed" {
  const outcome = classifyTabPress(view.state);
  if (outcome.kind === "fall") return "fall";
  let reason: TabSwallowReason;
  if (outcome.kind === "swallow") reason = outcome.reason;
  else if (!guardTableWrite(outcome.model, "source.tab_nav")) reason = "guard-refused";
  else return outcome.model;
  logTabSwallow(view.state, key, reason);
  return "swallowed";
}

/** Move to the next cell, or append one row past the last. See the module header. */
export const tableTabCommand: Command = (view) => {
  const model = modelForPress(view, "Tab");
  if (model === "fall") return false;
  if (model === "swallowed") return true;
  const head = view.state.selection.main.head;
  const next = model.cells.find((c) => c.start > head);
  if (next) {
    view.dispatch({ selection: EditorSelection.cursor(next.start) });
    return true;
  }
  appendBlankRow(view, model);
  return true;
};

/** Move to the previous cell; swallow (`first-cell`) when there is none. */
export const tableShiftTabCommand: Command = (view) => {
  const model = modelForPress(view, "Shift-Tab");
  if (model === "fall") return false;
  if (model === "swallowed") return true;
  const head = view.state.selection.main.head;
  let prev: TableModel["cells"][number] | undefined;
  for (const c of model.cells) if (c.end < head) prev = c;
  if (!prev) {
    logTabSwallow(view.state, "Shift-Tab", "first-cell");
    return true;
  }
  view.dispatch({ selection: EditorSelection.cursor(prev.start) });
  return true;
};

/**
 * Append exactly one blank row at `model.end` — `"\n|" + "  |" × colCount`,
 * nothing after it — in one transaction, collapsing the selection to one
 * cursor in the new row's first cell (`model.end + 3`).
 */
function appendBlankRow(view: EditorView, model: TableModel): void {
  const insert = "\n|" + "  |".repeat(model.colCount);
  view.dispatch({
    changes: { from: model.end, insert },
    selection: EditorSelection.cursor(model.end + 3),
  });
}

/** Keymap entries to register on the source editor. */
export const sourceTableTabKeymap: KeyBinding[] = [
  { key: "Tab", run: tableTabCommand },
  { key: "Shift-Tab", run: tableShiftTabCommand },
];
