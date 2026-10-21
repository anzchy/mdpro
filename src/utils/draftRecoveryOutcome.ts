/**
 * Purpose: pure mapping from a draft-service outcome to what the recovery dialog does with
 * the clicked row (D27, ADR-0038). Owns the recovered `Document` construction formerly
 * inlined in `App.tsx`.
 *
 * Invariant over {recover, discard} × {ok, gone:in_use, gone:not_found, error}:
 * - `dropRow XOR toast` — every click either resolves the row or tells the user (one signal).
 * - `upsert ⇒ recover ∧ ok`.
 * - `in_use ⇒ ¬dropRow ∧ toast ∧ allowKeep`; `not_found ⇒ dropRow ∧ ¬toast`.
 *
 * @coordinates-with src/services/draftService.ts — produces the outcomes
 * @coordinates-with src/App.tsx — applies the result (upsert, drop row, toast)
 * @coordinates-with src/utils/recoverIntoOpenTab.ts — places the `upsert` document: into an
 *   open clean tab of the same path under that tab's id, else under the draft id (D146)
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
  allowKeep?: boolean;
}

const RECOVER_FAILED_TOAST = "Failed to recover draft";
const DISCARD_FAILED_TOAST = "Failed to discard draft";
const IN_USE_TOAST = "Draft is in use; try again or keep it for later.";
const IN_USE_DETAILS = {
  owned_by_live_window: "This draft is owned by another live window. Close it or keep the draft for later.",
  open_in_other_window: "This file is open in another window. Close it or keep the draft for later.",
  shadow_store_unavailable: "Could not check open windows. Try again or keep the draft for later.",
} as const;

function inUseToast(detail?: keyof typeof IN_USE_DETAILS): string {
  return detail ? IN_USE_DETAILS[detail] : IN_USE_TOAST;
}

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
        return outcome.reason === "in_use"
          ? { dropRow: false, toast: inUseToast(outcome.detail), allowKeep: true }
          : { dropRow: true };
      case "error":
        return { dropRow: false, toast: RECOVER_FAILED_TOAST };
    }
  }
  const { outcome } = input;
  switch (outcome.kind) {
    case "ok":
      return { dropRow: true };
    case "gone":
      return outcome.reason === "in_use"
        ? { dropRow: false, toast: inUseToast(outcome.detail), allowKeep: true }
        : { dropRow: true };
    case "error":
      return { dropRow: false, toast: DISCARD_FAILED_TOAST };
  }
}
