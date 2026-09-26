/**
 * Purpose: pure mapping from a draft-service outcome to what the recovery dialog does with
 * the clicked row (D27, ADR-0038). Owns the recovered `Document` construction formerly
 * inlined in `App.tsx`.
 *
 * Invariant over {recover, discard} × {ok, gone:in_use, gone:not_found, error}:
 * - `dropRow XOR toast` — every click either resolves the row or tells the user (one signal).
 * - `upsert ⇒ recover ∧ ok`.
 * - `gone ⇒ ¬upsert ∧ ¬toast` — a draft in use elsewhere, or already gone, just leaves the list.
 *
 * @coordinates-with src/services/draftService.ts — produces the outcomes
 * @coordinates-with src/App.tsx — applies the result (upsert, drop row, toast)
 */
import type { Document } from "../types/document";
import type { DiscardOutcome, RecoverOutcome, RecoverResult } from "../services/draftService";

export type DraftActionOutcome =
  | { action: "recover"; outcome: RecoverOutcome }
  | { action: "discard"; outcome: DiscardOutcome };

export interface DraftRowOutcome {
  dropRow: boolean;
  upsert?: Document;
  toast?: string;
}

const RECOVER_FAILED_TOAST = "Failed to recover draft";
const DISCARD_FAILED_TOAST = "Failed to discard draft";

function recoveredDocument(draftId: string, result: RecoverResult): Document {
  return {
    id: draftId,
    path: result.originalPath,
    content: result.content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: true,
    lastSaved: null,
    fileSize: null,
  };
}

export function draftRecoveryOutcome(draftId: string, input: DraftActionOutcome): DraftRowOutcome {
  if (input.action === "recover") {
    const { outcome } = input;
    switch (outcome.kind) {
      case "ok":
        return { dropRow: true, upsert: recoveredDocument(draftId, outcome.result) };
      case "gone":
        return { dropRow: true };
      case "error":
        return { dropRow: false, toast: RECOVER_FAILED_TOAST };
    }
  }
  const { outcome } = input;
  switch (outcome.kind) {
    case "ok":
    case "gone":
      return { dropRow: true };
    case "error":
      return { dropRow: false, toast: DISCARD_FAILED_TOAST };
  }
}
