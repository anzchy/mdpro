/**
 * Purpose: build the log payload for a Source table-extension withhold
 * (ADR-0022), so the second decision the large-document guard makes against
 * the user's wishes leaves a trace of its own.
 *
 * @module src/utils/sourceTableWithheldLog
 * @coordinates-with src/utils/largeDocumentGuard.ts — owns the Source predicate
 *   and `SOURCE_TABLE_ROW_THRESHOLD`; this module only reports what it decided.
 * @coordinates-with src/utils/largeDocumentDegradeLog.ts — the WYSIWYG
 *   degrade's builder, whose shape (warn/fail, thresholds beside measurements,
 *   no content) this one mirrors.
 * @coordinates-with src/App.tsx — the caller, inside the guard effect's
 *   `withhold-table-extensions` arm.
 *
 * Pipeline: decideLargeDocumentGuard -> (withhold arm, first verdict for the
 *   document) -> this builder -> loggingService.logEventSync ->
 *   invoke("log_event") -> ~/.mdpro/mdpro.log
 *
 * Key decisions:
 *
 * - **Its own event, not a widened `editor.large_document.degrade`.** A
 *   withhold leaves the view mode alone; a degrade takes WYSIWYG away. A query
 *   for one must not silently return the other. The degrade module's header
 *   demanded exactly this before the Source predicate existed.
 *
 * - **Named so it does not match `buildLargeDocumentDegradeLog(`.** The call-site
 *   pin C14 counts that string; a similar name would break its exactly-one count.
 *
 * - **The threshold is imported, not restated**, so a threshold change cannot
 *   leave this module reporting the previous one.
 *
 * - **Only `tableRows` is taken from the decision.** The `message` is the
 *   user-facing toast and is not copied (W9); no document content is carried at
 *   any size, because the logger has no redaction pass (W4, W12).
 *
 * - **`documentId` is the one field not from the decision.** The caller passes
 *   the active document's id (a UUID v4: metadata, not content) so a line can
 *   be tied to the document it describes. Required, so a caller cannot omit it
 *   silently. Context allowlist: `tableRows`, `sourceTableRowThreshold`,
 *   `documentId` — pinned exactly by W8 and W11.
 */
import type { LogEntryPayload } from "../types/logging";
import {
  SOURCE_TABLE_ROW_THRESHOLD,
  type LargeDocumentGuardDecision,
} from "./largeDocumentGuard";

/** The withhold arm of the guard's decision union. */
export type SourceTablesWithheldDecision = Extract<
  LargeDocumentGuardDecision,
  { action: "withhold-table-extensions" }
>;

/**
 * The grep key. Pinned as a literal by W7; renaming it breaks every saved query
 * against `~/.mdpro/mdpro.log`.
 */
export const SOURCE_TABLES_WITHHELD_EVENT =
  "editor.large_document.source_tables_withheld";

/**
 * Describe a Source table-extension withhold as a log entry: the table-row
 * count beside the threshold it exceeded, and the id of the document withheld,
 * at warn/fail like the degrade.
 *
 * @param documentId - the active document's id (UUID v4); never its content.
 */
export function buildSourceTablesWithheldLog(
  decision: SourceTablesWithheldDecision,
  actionId: string,
  documentId: string,
): LogEntryPayload {
  return {
    level: "warn",
    event: SOURCE_TABLES_WITHHELD_EVENT,
    status: "fail",
    actionId,
    context: {
      tableRows: decision.tableRows,
      sourceTableRowThreshold: SOURCE_TABLE_ROW_THRESHOLD,
      documentId,
    },
    error: "source table extensions withheld: too many table rows",
  };
}
