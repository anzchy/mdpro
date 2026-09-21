/**
 * Purpose: build the log payload for a large-document degrade, so the one
 * decision the app makes against the user's wishes leaves a trace.
 *
 * @module src/utils/largeDocumentDegradeLog
 * @coordinates-with src/utils/largeDocumentGuard.ts — owns the predicate and
 *   both thresholds; this module only reports what that one decided.
 * @coordinates-with src/App.tsx — the sole caller, inside the guard effect's
 *   `degrade-to-source` arm.
 *
 * Pipeline: decideLargeDocumentGuard -> (degrade arm) -> this builder ->
 *   loggingService.logEventSync -> invoke("log_event") -> ~/.mdpro/mdpro.log
 *
 * Key decisions:
 *
 * - **Separate module, not inline at the call site.** `src/App.tsx` has no
 *   test that renders it; every assertion about the guard effect in
 *   `tests/large-document-guard-call-site.test.ts` is source-text, which can
 *   prove a call is written but not what it carries. Extracting the payload
 *   makes its contents a behavioural claim
 *   (`tests/large-document-degrade-log.test.ts`). It also keeps App.tsx from
 *   growing, which rule 50 §6 already has a grievance about.
 *
 * - **Not folded into `largeDocumentGuard.ts`.** That module is pinned pure by
 *   C7, down to "exactly one import". Importing `LogEntryPayload` there would
 *   break it, and the guard staying free of logging concerns is the point of
 *   the pin, not an accident of it.
 *
 * - **The thresholds are reported alongside the measurements.** A line reading
 *   `elements: 30000` is unreadable without knowing the limit on that build.
 *   They are imported from their one home rather than restated, so a threshold
 *   change cannot leave this module reporting the previous one (the C8b'
 *   discipline, applied to the constants' second consumer).
 *
 * - **warn/fail, mirroring `tableWriteGuard.ts`:172-185.** Both events are the
 *   app declining to do what was asked; someone grepping the log for one
 *   should find the other.
 *
 * KNOWN AND ACCEPTED limit: this reports only the WYSIWYG entry decision,
 * because that is the only thing the guard judges —
 * `largeDocumentGuard.ts:260` returns `allow` for every other view mode. A
 * 9.96 MB document opened straight into Source costs whatever it costs and
 * produces no line here. That surface has no predicate yet (D6, and
 * §6.2 of docs/test/20260921-d6-matrix-retest.md); when it acquires one, it
 * needs its own event rather than a widened meaning for this one.
 */
import type { LogEntryPayload } from "../types/logging";
import {
  LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD,
  LARGE_DOCUMENT_STRUCTURE_THRESHOLD,
  type LargeDocumentGuardDecision,
} from "./largeDocumentGuard";

/** The degrade arm of the guard's decision union. */
export type LargeDocumentDegradeDecision = Extract<
  LargeDocumentGuardDecision,
  { action: "degrade-to-source" }
>;

/**
 * The grep key. Renaming it breaks every saved query against
 * `~/.mdpro/mdpro.log`, so it is pinned as a literal by L8 and should cost a
 * deliberate edit.
 */
export const LARGE_DOCUMENT_DEGRADE_EVENT = "editor.large_document.degrade";

/**
 * Describe a degrade as a log entry.
 *
 * Carries the two measurements, both thresholds, and the trigger that names
 * which of the two predicates fired — after ADR-0019 "the guard fired" is
 * ambiguous, and an unqualified line cannot answer the question this event was
 * added for.
 *
 * Carries no document content at any size: a degrade happens on documents up
 * to the 10 MB cap, and the logger has no redaction pass.
 */
export function buildLargeDocumentDegradeLog(
  decision: LargeDocumentDegradeDecision,
  actionId: string,
): LogEntryPayload {
  return {
    level: "warn",
    event: LARGE_DOCUMENT_DEGRADE_EVENT,
    status: "fail",
    actionId,
    context: {
      trigger: decision.trigger,
      elements: decision.elements,
      longestLine: decision.longestLine,
      structureThreshold: LARGE_DOCUMENT_STRUCTURE_THRESHOLD,
      lineLengthThreshold: LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD,
    },
    // Repeats the trigger because `error` is what a reader sees before
    // expanding `context`; the one-line summary has to distinguish the two
    // predicates on its own.
    error: `large document degraded to source: ${decision.trigger}`,
  };
}
