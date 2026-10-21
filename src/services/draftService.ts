/**
 * Purpose: typed IPC wrappers for the recovery dialog's two draft actions (D27, ADR-0038).
 * `recoverDraft` and `discardRecoveryDraft` call the guarded Rust commands, classify every
 * rejection into a closed outcome, never reject, and log one outcome-only line per call.
 *
 * Wire contract (args camelCase; Tauri injects the calling window):
 * - `recover_draft { documentId }` → `RecoverResult`
 * - `discard_recovery_draft { documentId }` → `boolean` (`false` = nothing to delete; still ok)
 * - rejections: `"OwnedByLiveWindow"` / `"OpenInWindow"` /
 *   `"ShadowStoreUnavailable"` → in_use with a typed reason,
 *   `{ NotFound: {...} }` → not_found, anything else → error.
 *
 * Key decisions:
 * - Saves keep calling the unguarded `delete_draft` (saveService); this module never does.
 * - Logs carry the outcome enum only — no document id, path, title or error text.
 * - D173: a recover's `holdGen` goes into the window's watch-hold ledger; with no
 *   reservation it is checked only when a document on that path goes away.
 *
 * @coordinates-with src/utils/draftRecoveryOutcome.ts — maps outcomes to dialog effects
 * @coordinates-with src-tauri/src/commands/draft_recovery.rs — the guarded commands
 */
import { invoke } from "@tauri-apps/api/core";
import { noteHold } from "../utils/watchHoldLedger";
import { loggingService } from "./loggingService";
import { useDocumentStore } from "../stores/documentStore";

export interface DraftMetadata {
  id: string;
  originalPath: string | null;
  lastModified: string;
  recovered: boolean;
  title: string;
  /** Set after a guarded in-use refusal; enables Keep for later on this row. */
  inUseRefused?: boolean;
}

export interface RecoverResult {
  content: string;
  originalPath: string | null;
  title: string;
  /** D173: the gen of the watch hold on `originalPath` for this window; 0 = none. */
  holdGen?: number;
  target?: { id: string; storedPath: string | null } | null;
  claimToken?: { sourceId: string; nonce: string; sessionId: string };
}

const recoveryStartGenerations = new WeakMap<RecoverResult, number>();
const recoveryStartDocuments = new WeakMap<RecoverResult, Map<string, object>>();
/** The store generation at the Recover click, before the Rust await. */
export function recoveryStartGeneration(result: RecoverResult): number | undefined {
  return recoveryStartGenerations.get(result);
}
/** Whether Rust's target is still the same document object seen at the click. */
export function recoveryTargetUnchanged(result: RecoverResult, id: string): boolean {
  return recoveryStartDocuments.get(result)?.get(id) === useDocumentStore.getState().getDocumentById(id);
}

export type GoneReason = "in_use" | "not_found";
export type InUseDetail = "owned_by_live_window" | "open_in_other_window" | "shadow_store_unavailable";
export type DraftErrorClass =
  | { kind: "gone"; reason: "in_use"; detail?: InUseDetail }
  | { kind: "gone"; reason: "not_found" }
  | { kind: "error" };
export type RecoverOutcome = { kind: "ok"; result: RecoverResult } | DraftErrorClass;
export type DiscardOutcome = { kind: "ok" } | DraftErrorClass;

type LoggedOutcome = "ok" | GoneReason | "error";

const IN_USE_ERRORS: Readonly<Record<string, InUseDetail>> = {
  OwnedByLiveWindow: "owned_by_live_window",
  OpenInWindow: "open_in_other_window",
  ShadowStoreUnavailable: "shadow_store_unavailable",
};

/** Map a rejected `invoke` value to a closed class. Exact shapes only; no substring matching. */
export function classifyDraftError(err: unknown): DraftErrorClass {
  if (typeof err === "string") {
    return Object.prototype.hasOwnProperty.call(IN_USE_ERRORS, err)
      ? { kind: "gone", reason: "in_use", detail: IN_USE_ERRORS[err] }
      : { kind: "error" };
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
    context: outcome.kind === "gone" && outcome.reason === "in_use"
      ? { outcome: name, reason: outcome.detail ?? "unspecified" }
      : { outcome: name },
  });
}

/** Recover a draft through the guarded command. Never rejects. */
export async function recoverDraft(documentId: string): Promise<RecoverOutcome> {
  const atClick = useDocumentStore.getState();
  const startedGeneration = atClick.baselineGeneration;
  const documentsAtClick = new Map(atClick.documents.map((doc) => [doc.id, doc]));
  let outcome: RecoverOutcome;
  try {
    const result = await invoke<RecoverResult>("recover_draft", { documentId });
    recoveryStartGenerations.set(result, startedGeneration);
    recoveryStartDocuments.set(result, documentsAtClick);
    noteHold(result?.originalPath, result?.holdGen); // D173: released when its tab goes
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
