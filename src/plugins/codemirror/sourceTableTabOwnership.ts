/**
 * @module sourceTableTabOwnership
 * Purpose: decide who owns a Source-mode Tab / Shift-Tab press (D41 WI-4,
 * ADR-0046). Every press has exactly one outcome:
 *   - `fall`: no line of interest is a table line → the editor's default
 *     indent runs (prose, fenced code, the line after a table, withheld
 *     documents, which have no detection field);
 *   - `swallow`: the press touches a table but cannot navigate → handled,
 *     nothing changes, one `ui.table.tab_swallowed` log;
 *   - `table`: the main head is in one table and every line of interest is
 *     in that table → the caller navigates on `model`.
 *
 * Lines of interest, per selection range: an empty range gives its head
 * line; otherwise `lineAt(from)..lineAt(to)`, dropping the last line when
 * `to` is its start and it is not the head line. The head line is always
 * included. Lines are REAL `Text` lines (`doc.lineAt`), never the detection
 * field's adjusted `lineIndexAt`; the field (`getTableContext`) is not read.
 *
 * Swallow reasons decided here, first match wins: `multi-table` (two or more
 * distinct tables) > `mixed-selection` (one table plus a prose or fenced
 * line) > `delimiter-row` (main head on the delimiter line). The caller adds
 * `guard-refused` and `first-cell`, in that order, after this shape check —
 * so no model is guarded for a selection that is swallowed on shape.
 *
 * Cost (pinned by `tests/source-table-tab-ownership-cost.test.ts`): one
 * `parseTableAtLine` for a head line that is a table candidate; at most one
 * `locateTableAtLine` per maximal run of consecutive candidate lines of
 * interest, relying on the walker fact that a table's header is the first
 * line of its candidate run (a null probe clears the whole run); one
 * `linesFromText` adapter per press, built only when something is probed.
 * Never copies the document.
 *
 * @coordinates-with src/plugins/codemirror/sourceTableTabNav.ts — the only caller.
 * @coordinates-with src/plugins/codemirror/sourceTableDetection.ts — fence check, `hasTableDetection`.
 * @coordinates-with src/utils/tableParser/locate.ts
 * @coordinates-with src/utils/tableParser/parse.ts
 */
import type { EditorState, Text } from "@codemirror/state";
import type { TableModel } from "../../utils/tableParser";
import { isDelimiterLine, isTableCandidateLine } from "../../utils/tableParser/lines";
import { locateTableAtLine } from "../../utils/tableParser/locate";
import { parseTableAtLine } from "../../utils/tableParser/parse";
import type { TableLineSource } from "../../utils/tableParser/lines";
import { loggingService } from "../../services/loggingService";
import { hasTableDetection, isPositionInFencedCode } from "./sourceTableDetection";
import { linesFromText } from "./textLineSource";

export type TabSwallowReason =
  | "multi-table"
  | "mixed-selection"
  | "delimiter-row"
  | "guard-refused"
  | "first-cell";

export type TabOwnership =
  | { kind: "fall" }
  | { kind: "swallow"; reason: TabSwallowReason }
  | { kind: "table"; model: TableModel };

/** Sorted, de-duplicated 0-based line indices of interest, and the main head's line. */
function linesOfInterest(state: EditorState): { lines: number[]; headLine: number } {
  const doc = state.doc;
  const out = new Set<number>();
  for (const r of state.selection.ranges) {
    const headLine = doc.lineAt(r.head).number;
    out.add(headLine - 1);
    if (r.empty) continue;
    const last = doc.lineAt(r.to);
    const end = r.to === last.from && last.number !== headLine ? last.number - 1 : last.number;
    for (let n = doc.lineAt(r.from).number; n <= end; n += 1) out.add(n - 1);
  }
  const lines = [...out].sort((a, b) => a - b);
  return { lines, headLine: doc.lineAt(state.selection.main.head).number - 1 };
}

/**
 * How line `idx` could take part in a table: `"candidate"` (a candidate row),
 * `"delimiter"` (a pipe-less delimiter, which breaks candidate runs), or null
 * for prose. Fenced lines are always null.
 */
function shapeOf(state: EditorState, doc: Text, idx: number): "candidate" | "delimiter" | null {
  const line = doc.line(idx + 1);
  const range = { start: line.from, end: line.to, text: line.text };
  const shape = isTableCandidateLine(range) ? "candidate" : isDelimiterLine(range) ? "delimiter" : null;
  if (shape === null || isPositionInFencedCode(state, line.from)) return null;
  return shape;
}

/** Classify one press. Builds at most the head line's model; see the module header for cost. */
export function classifyTabPress(state: EditorState): TabOwnership {
  if (!hasTableDetection(state)) return { kind: "fall" };
  const doc = state.doc;
  const { lines, headLine } = linesOfInterest(state);
  const shapes = new Map<number, "candidate" | "delimiter">();
  for (const l of lines) {
    const shape = shapeOf(state, doc, l);
    if (shape !== null) shapes.set(l, shape);
  }
  const shaped = [...shapes.keys()];
  if (shaped.length === 0) return { kind: "fall" };
  // Consecutive candidate lines are one run of the document; a pipe-less delimiter is its own run.
  const sameRun = (a: number, b: number) =>
    b === a + 1 && shapes.get(a) === "candidate" && shapes.get(b) === "candidate";

  let src: TableLineSource | null = null;
  const source = () => (src ??= linesFromText(doc));
  // line index → table key (its start offset); absent = prose.
  const tableOf = new Map<number, number>();
  const mark = (first: number, last: number, key: number) => {
    for (let l = first; l <= last; l += 1) tableOf.set(l, key);
  };

  let model: TableModel | null = null;
  if (shapes.has(headLine)) {
    model = parseTableAtLine(source(), headLine);
    if (model) mark(doc.lineAt(model.start).number - 1, doc.lineAt(model.end).number - 1, model.start);
  }

  // Probe each maximal run of consecutive shaped lines once (plus after a found span).
  let i = 0;
  while (i < shaped.length) {
    let j = i;
    while (j + 1 < shaped.length && sameRun(shaped[j], shaped[j + 1])) j += 1;
    const runHasHead = shaped[i] <= headLine && headLine <= shaped[j];
    for (let k = i; k <= j; k += 1) {
      const l = shaped[k];
      if (tableOf.has(l)) continue;
      if (runHasHead && model === null) break; // the head's probe already cleared this run
      const span = locateTableAtLine(source(), l);
      if (span === null) break; // walker fact: nothing in this run is a table
      mark(span.headerLine, span.lastLine, span.start);
    }
    i = j + 1;
  }

  const keys = new Set<number>();
  let prose = false;
  for (const l of lines) {
    const key = tableOf.get(l);
    if (key === undefined) prose = true;
    else keys.add(key);
  }
  if (keys.size === 0) return { kind: "fall" };
  if (keys.size > 1) return { kind: "swallow", reason: "multi-table" };
  if (prose || model === null) return { kind: "swallow", reason: "mixed-selection" };
  const headerLine = doc.lineAt(model.start).number - 1;
  if (headLine === headerLine + 1) return { kind: "swallow", reason: "delimiter-row" };
  return { kind: "table", model };
}

/**
 * Log a swallowed press. The context is exactly `{controlId, key, reason,
 * ranges}` — offsets only, never document text.
 */
export function logTabSwallow(state: EditorState, key: "Tab" | "Shift-Tab", reason: TabSwallowReason): void {
  loggingService.logEventSync({
    level: "info",
    event: "ui.table.tab_swallowed",
    status: "cancel",
    context: {
      controlId: "source.tab_nav",
      key,
      reason,
      ranges: state.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head })),
    },
  });
}
