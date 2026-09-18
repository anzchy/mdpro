/**
 * @module tableParser/scan
 * Purpose: Linear whole-document table enumeration (Phase 4 WI-3). Walks
 * the line index once and probes `parseTableAtLine` exactly once per
 * maximal run of table-candidate lines, replacing the previous
 * probe-every-offset loop whose cost was O(lines x document) whenever a
 * table failed to parse.
 *
 * Pipeline: `TableLineSource` -> `scanTables` -> one `parseTableAtLine`
 * probe per candidate run -> `TableModel[]` in document order.
 * `cursorSync/table.ts#findAllTables` is the string-shaped entry point and
 * is a thin delegation: `scanTables(linesFromString(source), isFenced)`.
 *
 * Key decisions:
 *  - One algorithm, two adapters, never two parsers. Everything here works
 *    against `TableLineSource`; nothing in this file knows whether the
 *    document arrived as a `string` or a CodeMirror `Text`.
 *  - `isFenced` is called ONLY for models that actually parsed, in document
 *    order. `lintTableColumnCount` passes a predicate that resolves a
 *    `syntaxTree`, so a speculative per-candidate-line call would multiply
 *    those resolves on the lint timer.
 *  - No import from `cursorSync/` or `@codemirror/state` — enforced by
 *    `SCAN-nocycle` in `tests/table-scan-enumeration.test.ts`.
 *
 * @coordinates-with src/utils/tableParser/lines.ts
 * @coordinates-with src/utils/tableParser/parse.ts
 * @coordinates-with src/utils/cursorSync/table.ts
 */

import { isTableCandidateLine, type TableLineSource } from "./lines";
import { parseTableAtLine } from "./parse";
import { type IsFenced, type TableModel } from "./types";

/**
 * WHY ONE PROBE PER RUN ENUMERATES THE SAME TABLES — and the one class
 * where it deliberately does not. This is the whole safety argument for
 * WI-3; it is recorded here rather than in a plan because the plan is not
 * what a future reader of this loop will have open.
 *
 * The replaced implementation probed essentially every line. Probing at
 * line `i` first walks UP to the first line of `i`'s candidate run, so:
 *
 *  1. Every probe that lands inside a candidate run resolves to the same
 *     header line — the run's first line — and therefore produces the same
 *     model, or the same `null`. Probing once at the run's first line is
 *     that same computation, done once. It also makes the walk-up terminate
 *     after one predicate call, because the line above a run's first line
 *     is by construction not a candidate.
 *  2. A probe on a NON-candidate line returns `null` immediately: the
 *     walk-up cannot move (the line above is either a non-candidate or
 *     outside the document), and `isTableCandidateLine` then rejects the
 *     line itself. So skipping non-candidate lines loses nothing.
 *  3. When a model is emitted, its last line is `runStart + rowCount`
 *     (header, delimiter, then `rowCount - 1` body rows on consecutive
 *     lines — see `parseTableAtLine`). Resuming at the line after it skips
 *     only lines the model already covers, each of which would have
 *     re-derived the same model.
 *
 * THE CHARACTERIZED EXCEPTION — ADR-0007, superseded by ADR-0008 on
 * 2026-09-17 (`docs/adr/0008-non-candidate-delimiter-class-measured-against-gfm.md`).
 * ADR-0007's Decision stands unchanged; its Context is factually wrong
 * about what GFM does here. Read 0008 first.
 *
 * Step 3 hides an assumption that is false in one reachable class. The
 * walk-down in `parseTableAtLine` starts at `headerIdx + 2`, so the
 * DELIMITER ROW IS NEVER CANDIDACY-CHECKED. A delimiter that `parseTable-
 * AtLine` accepts but `isTableCandidateLine` rejects — pipe-less (`---`,
 * `:-:`; edge pipes are optional) or indented 4+ spaces (`    | - | - |`;
 * `isDelimiterLine` trims before splitting, `isTableCandidateLine` rejects
 * on `MAX_INDENT`) — sits INSIDE a model while SPLITTING the candidate
 * run. The model's line span then exceeds its run.
 *
 * Do NOT call this class "valid GFM" — ADR-0007 did, and measurement
 * against `micromark-extension-gfm-table@2.1.2` refuted it. `:-:` is a
 * real delimiter, but `---` loses to the setext heading underline and a
 * 4+-space indent is a paragraph, so BOTH produce zero GFM tables. mdpro
 * over-detects them; that is a separate recorded defect (ADR-0008,
 * Consequences), not something this scanner introduced or fixes. The
 * overlap removed below therefore moves mdpro TOWARD the reference parser.
 *
 * On such a document the old loop, having emitted a model, advanced past
 * two newlines and landed on an offset that the offset->line resolver
 * attributed to the PREVIOUS line (it deliberately treats
 * `offset === line.end + 1` as belonging to the line above). That put the
 * probe back inside the model it had just emitted and built a SECOND,
 * OVERLAPPING model whose header was the first model's last body row:
 *
 *     "| a | b |\n    | - | - |\n| 1 | 2 |\n    | - | - |\n| 3 | 4 |\n"
 *       old: [0, 33] AND [24, 57]   — `| 1 | 2 |` belongs to both
 *       new: [0, 33]                — this scanner
 *
 * The overlap is an interaction between that resolver fudge and the
 * non-candidate delimiter, not a property of either alone — which is why
 * bypassing offset resolution here is exactly what suppresses it. Resuming
 * after the RUN would reproduce the overlap; resuming after the MODEL
 * removes it. Both are one line, so there was no version of WI-3 that
 * changed nothing, and ADR-0007 chose removal: emitted models are pairwise
 * non-overlapping on every input.
 *
 * So the correct claim for this file is NOT "behaviour-preserving". It is:
 * output-identical to the replaced implementation except for the removal of
 * overlapping models on documents containing a valid non-candidate
 * delimiter. Both sides of that exception are pinned by literal value in
 * `SCAN-noncandidate-delimiter`, and exact identity outside it is asserted
 * against a frozen byte-copy of the old code in `SCAN-oracle`.
 *
 * The `offset === line.end + 1` quirk itself is NOT fixed here. It keeps
 * its own work item; this scanner simply no longer routes through it.
 *
 * @param source split document to enumerate
 * @param isFenced optional filter; called once per PARSED model, in
 *   document order, never for candidate lines that did not yield a table
 * @returns every GFM table in document order, pairwise non-overlapping
 */
export function scanTables(
  source: TableLineSource,
  isFenced?: IsFenced,
): TableModel[] {
  const out: TableModel[] = [];
  const lineCount = source.lineCount;

  let i = 0;
  while (i < lineCount) {
    if (!isTableCandidateLine(source.line(i))) {
      i += 1;
      continue;
    }

    // `i` is the first line of a maximal candidate run — one probe.
    const model = parseTableAtLine(source, i);
    if (model) {
      if (!isFenced || !isFenced(model.start)) out.push(model);
      // Resume after the model's LAST line (ADR-0007). See point 3 above
      // for why `i + model.rowCount` is that line.
      i = i + model.rowCount + 1;
      continue;
    }

    // No table starts this run, so no line in it can start one either
    // (they all walk up to `i`). Skip the whole run.
    i += 1;
    while (i < lineCount && isTableCandidateLine(source.line(i))) i += 1;
  }

  return out;
}
