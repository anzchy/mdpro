/**
 * Purpose: the two pure pieces of glue that make App's large-document guard
 * scan a document once per session in Source rather than once per keystroke
 * (ADR-0022 Consequences: one pass on the Source open path; plan amendment A1).
 *
 * @module src/utils/sourceTableVerdict
 * @coordinates-with src/stores/editorStore.ts — owns `sourceTableVerdicts`,
 *   `recordSourceTableVerdict` and `hasSourceTableVerdict`, read here.
 * @coordinates-with src/utils/largeDocumentGuard.ts — produces the decision
 *   `sourceTableVerdictOf` maps to a verdict.
 * @coordinates-with src/App.tsx — the caller (its large-document guard effect), in this
 *   order: shouldEvaluateGuard -> decideLargeDocumentGuard ->
 *   sourceTableVerdictOf -> recordSourceTableVerdict.
 *
 * Key decisions:
 *
 * - **Skip on any verdict, not only "withheld".** Skipping only withheld
 *   documents would rescan every allowed document on every edit — exactly the
 *   per-keystroke pass A1 removes.
 * - **WYSIWYG never skips and never records.** Its behaviour is unchanged, and
 *   a WYSIWYG allow must not stand in for a Source verdict: the WYSIWYG
 *   decision does not look at the table-row count.
 *
 * KNOWN AND ACCEPTED (A1): a verdict is taken at the first Source evaluation
 * and kept for the session, so a document that grows past the threshold by
 * editing, or by an external reload under the same id, keeps its open-time
 * verdict until it is reopened.
 */
import type { ViewMode } from "../types/editor";
import {
  hasSourceTableVerdict,
  type EditorStoreState,
  type SourceTableVerdict,
} from "../stores/editorStore";
import type { LargeDocumentGuardDecision } from "./largeDocumentGuard";

/**
 * Whether App should run the guard for this document now: `false` exactly when
 * the mode is Source and the document already has a recorded verdict.
 */
export function shouldEvaluateGuard(
  viewMode: ViewMode,
  docId: string,
  state: Pick<EditorStoreState, "sourceTableVerdicts">,
): boolean {
  return !(viewMode === "source" && hasSourceTableVerdict(state, docId));
}

/**
 * The verdict a guard decision records, or `null` when it records none. Only
 * Source decisions record: allow -> "allowed", withhold -> "withheld".
 */
export function sourceTableVerdictOf(
  viewMode: ViewMode,
  decision: LargeDocumentGuardDecision,
): SourceTableVerdict | null {
  if (viewMode !== "source") return null;
  switch (decision.action) {
    case "allow":
      return "allowed";
    case "withhold-table-extensions":
      return "withheld";
    case "degrade-to-source":
      return null;
  }
}
