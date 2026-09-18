/**
 * @module tableWriteGuard
 * Purpose: WI-C0 — a write-boundary backstop for the GFM table detector.
 * Every surface that rewrites document bytes from a `TableModel` asks
 * this module first; a model whose own bytes do not look like a GFM
 * table is refused, the bytes are left untouched, and the refusal is
 * written to `~/.mdpro/mdpro.log`.
 *
 * Plan: `docs/plans/20260917-plan-table-over-detection-vs-gfm.md` (WI-C0,
 * §3.1 write-path inventory, §3.2 the measured data-loss reproduction).
 *
 * Key decisions:
 *
 *  - **This is defence-in-depth, not a fix for a reachable defect.**
 *    WI-C1 / WI-C2 narrowed the scanner itself, and the §3.2
 *    reproduction is dead: measured on 2026-09-18 against
 *    `micromark-extension-gfm-table@2.1.2` (via `remark-gfm@4.0.1`) over
 *    both corpora in `tests/support/tableCorpus.ts` — `makeCorpus(SEED,
 *    200)` and `makeOverlapCorpus(OVERLAP_SEED, 200)`, 400 documents —
 *    **zero** mdpro tables covered a byte that GFM does not consider
 *    table content. The residual disagreement is all UNDER-detection
 *    (62 GFM tables mdpro does not find), which cannot produce a bad
 *    write: you cannot edit a table you never enumerated. The guard
 *    exists so that a future widening of `parse.ts` / `scan.ts` cannot
 *    silently reach the four write paths again.
 *
 *  - **The plan's proposed condition ("the delimiter row must itself be
 *    a candidate line") is wrong in BOTH directions and is not what is
 *    implemented here.**
 *      * Too weak: a tab-indented *header* (shape S3′) has a perfectly
 *        ordinary delimiter row, so a delimiter-only test waves it
 *        through. The guard therefore checks the header's indent too.
 *      * Too strong: `isTableCandidateLine` requires an unescaped `|`,
 *        but a single-column table may spell its delimiter `:-:` with no
 *        pipe at all. That is a genuine GFM table (shape A1, §5.2) that
 *        the shipped scanner still parses, and the plan's condition
 *        would refuse edits to it. The guard tests the delimiter with
 *        `isDelimiterLine` + the setext rule instead.
 *
 *  - The predicates are imported from `tableParser`, not restated, so
 *    there is one definition of "what a GFM table line is" (rule 50).
 *    That bounds what this guard can catch: drift in `parse.ts` /
 *    `scan.ts` structure, yes; drift inside `isDelimiterLine` /
 *    `isTableCandidateLine` themselves, no — the guard would drift with
 *    them. The independent axis here is the *site*, not the algorithm.
 *
 *  - Refusals log offsets and shape only, never cell text: the log is a
 *    plain file on disk and the document is the user's content
 *    (rule 60, "events contain only serializable, non-secret data").
 *
 * @coordinates-with src/utils/tableParser/lines.ts
 * @coordinates-with src/utils/tableParser/commonmark.ts
 * @coordinates-with src/utils/tableMcp.ts
 * @coordinates-with src/utils/tableFormatter.ts
 * @coordinates-with src/plugins/codemirror/sourceTableContextMenu.ts
 * @coordinates-with src/plugins/codemirror/sourceTableTabNav.ts
 */

import { countIndentColumns, isSetextUnderline } from "./tableParser/commonmark";
import { isDelimiterLine, isTableCandidateLine } from "./tableParser/lines";
import { MAX_INDENT, type LineRange, type TableModel } from "./tableParser/types";
import { loggingService } from "../services/loggingService";

/**
 * Why a model was refused. Each value names the CommonMark/GFM rule the
 * model's own bytes break, so a log line is actionable without the
 * document.
 */
export type TableWriteRefusalReason =
  /** `rowCount` or `colCount` below 1 — nothing coherent to rewrite. */
  | "degenerate-dimensions"
  /** `raw` has no second line, so there is no delimiter row at all. */
  | "missing-delimiter-row"
  /** Header indented 4+ CommonMark columns (a tab counts as 4) — shape S3′. */
  | "header-indented"
  /** Header is blank or carries no unescaped `|`. */
  | "header-not-candidate"
  /** Delimiter indented 4+ columns — shapes S2 / S3. */
  | "delimiter-indented"
  /** Delimiter is a `-`-only run: GFM reads it as a setext H2 — shape S1. */
  | "setext-underline"
  /** Second line is not a delimiter row in any spelling. */
  | "not-a-delimiter-row"
  /** A body row inside the model's span is not a table line. */
  | "body-row-not-candidate";

/** The write surfaces this guard protects — plan §3.1, W1-W4. */
export type TableWriteSurface =
  | "mcp.set_cell"
  | "mcp.table_edit"
  | "format.all_tables"
  | "source.context_menu"
  | "source.tab_nav";

/**
 * Re-derive the model's own lines from `raw`, with absolute offsets and
 * CR handling identical to `tableParser/lines.ts#splitLines`: the `\r` of
 * a CRLF pair is excluded from both `text` and `end`, but still occupies
 * a source offset.
 */
function modelLines(model: TableModel): LineRange[] {
  const out: LineRange[] = [];
  let cursor = model.start;
  for (const segment of model.raw.split("\n")) {
    const hasCR = segment.endsWith("\r");
    const text = hasCR ? segment.slice(0, -1) : segment;
    out.push({ start: cursor, end: cursor + text.length, text });
    cursor += segment.length + 1;
  }
  return out;
}

/**
 * Decide whether `model` may be written back over its own source span.
 *
 * Returns `null` when the write may proceed, otherwise the reason it was
 * refused. Pure — logging is the caller's job via {@link guardTableWrite}.
 *
 * The checks run header-first, then delimiter, then body, and are ordered
 * so the reported reason is the most specific rule broken.
 */
export function refuseTableWrite(model: TableModel): TableWriteRefusalReason | null {
  if (model.rowCount < 1 || model.colCount < 1) return "degenerate-dimensions";

  const lines = modelLines(model);
  if (lines.length < 2) return "missing-delimiter-row";

  const header = lines[0];
  const delimiter = lines[1];

  // S3′: a tab advances to column 4, so a tab-indented header is an
  // indented code block in CommonMark even though its delimiter row below
  // it looks perfectly normal. Checked explicitly rather than left to
  // `isTableCandidateLine` so the refusal carries its own reason.
  if (countIndentColumns(header.text) > MAX_INDENT) return "header-indented";
  if (!isTableCandidateLine(header)) return "header-not-candidate";

  // S2 / S3: same rule, delimiter side.
  if (countIndentColumns(delimiter.text) > MAX_INDENT) return "delimiter-indented";
  // S1: `---` under a paragraph line is a setext H2 underline, and GFM
  // resolves the collision in setext's favour. Deliberately checked
  // BEFORE `isDelimiterLine`, which accepts that spelling.
  if (isSetextUnderline(delimiter.text)) return "setext-underline";
  // NOT `isTableCandidateLine` here: a single-column delimiter may be
  // spelled `:-:` with no pipe and is still a real GFM delimiter row.
  if (!isDelimiterLine(delimiter)) return "not-a-delimiter-row";

  for (let i = 2; i < lines.length; i += 1) {
    if (!isTableCandidateLine(lines[i])) return "body-row-not-candidate";
  }

  return null;
}

/**
 * {@link refuseTableWrite} plus the structured log line.
 *
 * Returns true when the caller may proceed. On refusal the caller must
 * leave the source bytes untouched; nothing else in the app surfaces the
 * refusal, so this log entry is the only trace (see the module header on
 * the Rust 202-before-apply contract, which is out of scope for WI-C0).
 *
 * Only offsets and shape are logged — never cell text.
 */
export function guardTableWrite(
  model: TableModel,
  surface: TableWriteSurface,
): boolean {
  const reason = refuseTableWrite(model);
  if (reason === null) return true;

  loggingService.logEventSync({
    level: "warn",
    event: "ui.table.write_refused",
    status: "fail",
    context: {
      controlId: surface,
      reason,
      start: model.start,
      end: model.end,
      rowCount: model.rowCount,
      colCount: model.colCount,
    },
    error: `table write refused: ${reason}`,
  });
  return false;
}
