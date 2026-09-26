/**
 * Purpose: typed IPC wrappers for the recovery dialog's two draft actions (D27, ADR-0038).
 * `recoverDraft` and `discardRecoveryDraft` call the guarded Rust commands, classify every
 * rejection into a closed outcome, never reject, and log one outcome-only line per call.
 *
 * Wire contract (args camelCase; Tauri injects the calling window):
 * - `recover_draft { documentId }` → `RecoverResult`
 * - `discard_recovery_draft { documentId }` → `boolean` (`false` = nothing to delete; still ok)
 * - rejections: `"OwnedByLiveWindow"` / `"OpenInWindow"` → in_use,
 *   `{ NotFound: {...} }` → not_found, anything else → error.
 *
 * Key decisions:
 * - Saves keep calling the unguarded `delete_draft` (saveService); this module never does.
 * - Logs carry the outcome enum only — no document id, path, title or error text.
 *
 * @coordinates-with src/utils/draftRecoveryOutcome.ts — maps outcomes to dialog effects
 * @coordinates-with src-tauri/src/commands/draft_recovery.rs — the guarded commands
 */
import { invoke } from "@tauri-apps/api/core";
import { loggingService } from "./loggingService";

export interface DraftMetadata {
  id: string;
  originalPath: string | null;
  lastModified: string;
  recovered: boolean;
  title: string;
}

export interface RecoverResult {
  content: string;
  originalPath: string | null;
  title: string;
}

export type GoneReason = "in_use" | "not_found";
export type DraftErrorClass = { kind: "gone"; reason: GoneReason } | { kind: "error" };
export type RecoverOutcome = { kind: "ok"; result: RecoverResult } | DraftErrorClass;
export type DiscardOutcome = { kind: "ok" } | DraftErrorClass;

type LoggedOutcome = "ok" | GoneReason | "error";

const IN_USE_ERRORS: ReadonlySet<string> = new Set(["OwnedByLiveWindow", "OpenInWindow"]);

/** Map a rejected `invoke` value to a closed class. Exact shapes only; no substring matching. */
export function classifyDraftError(err: unknown): DraftErrorClass {
  if (typeof err === "string") {
    return IN_USE_ERRORS.has(err) ? { kind: "gone", reason: "in_use" } : { kind: "error" };
  }
  if (typeof err === "object" && err !== null && !(err instanceof Error) && "NotFound" in err) {
    return { kind: "gone", reason: "not_found" };
  }
  return { kind: "error" };
}

function outcomeName(outcome: RecoverOutcome | DiscardOutcome): LoggedOutcome {
  switch (outcome.kind) {
    case "ok":
      return "ok";
    case "gone":
      return outcome.reason;
    case "error":
      return "error";
  }
}

function logOutcome(action: "recover" | "discard", outcome: RecoverOutcome | DiscardOutcome) {
  const name = outcomeName(outcome);
  loggingService.logEventSync({
    level: name === "error" ? "warn" : "info",
    event: `file.draft.${action}`,
    status: name === "error" ? "fail" : "success",
    actionId: loggingService.generateActionId(),
    context: { outcome: name },
  });
}

/** Recover a draft through the guarded command. Never rejects. */
export async function recoverDraft(documentId: string): Promise<RecoverOutcome> {
  let outcome: RecoverOutcome;
  try {
    const result = await invoke<RecoverResult>("recover_draft", { documentId });
    outcome = { kind: "ok", result };
  } catch (error: unknown) {
    outcome = classifyDraftError(error);
  }
  logOutcome("recover", outcome);
  return outcome;
}

/** Discard a draft through the guarded command. `false` (nothing to delete) is ok. Never rejects. */
export async function discardRecoveryDraft(documentId: string): Promise<DiscardOutcome> {
  let outcome: DiscardOutcome;
  try {
    await invoke<boolean>("discard_recovery_draft", { documentId });
    outcome = { kind: "ok" };
  } catch (error: unknown) {
    outcome = classifyDraftError(error);
  }
  logOutcome("discard", outcome);
  return outcome;
}
