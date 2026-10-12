/**
 * Purpose: build the frontend log payloads for D32's spurious "External change
 * detected" diagnosis — `file.change.received` (what the `file:changed`
 * listener did with an event) and `file.change.decision` (what the reload
 * decision concluded) — plus the dedupe key that stops the decision line from
 * re-logging on every render.
 *
 * @module src/utils/fileChangeLog
 * @coordinates-with src/utils/dataLossGuards.ts — owns `decideFileChange` and
 *   the `FileChangeAction` union; this module only reports what it decided.
 * @coordinates-with src/hooks/useFileWatcher.ts — the `received` caller (WI-5);
 *   its `FileChangedEvent` is structurally a `FileChangeLogEvent`.
 * @coordinates-with src/hooks/usePresentedFileChange.ts — logs `delivered` (D171).
 * @coordinates-with src-tauri/src/services/file_watcher_log.rs — the Rust
 *   `file.watch.event` line; `eventTimestamp` here is that event's `timestamp`
 *   verbatim, the join key between the two logs.
 *
 * Pipeline: file:changed event -> useFileWatcher (received) /
 *   decideFileChange (decision) -> these builders ->
 *   loggingService.logEventSync -> invoke("log_event") -> ~/.mdpro/mdpro.log
 *
 * Key decisions:
 *
 * - **Full paths are logged — a D32-scoped exception.** The path form
 *   (`/private/tmp` vs `/tmp`) is the variable under test, so it is logged
 *   un-normalised: the log must show exactly what the decision compared. To be
 *   removed or reduced when D32 closes.
 *
 * - **Never content, never `decision.message`.** Context is an explicit
 *   allowlist; neither the decision nor the document is spread into it, since
 *   the logger has no redaction pass. `newPath` is not logged either.
 *
 * - **`activePath` only when it differs from the event path**, so a matching
 *   line does not carry the same path twice.
 *
 * - **Every line is `info`.** Statuses: decision reload-prompt / deleted-prompt
 *   / rename -> success, ignore -> cancel (exhaustive switch; a fifth action is
 *   a compile error). Received other-path -> cancel, scheduled / recorded ->
 *   start, delivered -> success. Since D171 `other-path` means no open document
 *   has the path (not "not the active path"), and `recorded` is a change kept
 *   for a background document. (`save-suppressed` went with the frontend's 3 s save
 *   window in D86 WI-4.)
 *
 * - **`decisionLogKey` is a JSON tuple** of (timestamp, path, changeType,
 *   docId, action), so no separator inside a path or id can make two distinct
 *   tuples collide. Content and `isModified` are not inputs: typing never
 *   changes the key, while a second real change (new timestamp) does.
 */
import type { LogEntryPayload, LogStatus } from "../types/logging";
import type { FileChangeAction } from "./dataLossGuards";
import type { Document } from "../types/document";

/** The event fields the builders read; `useFileWatcher`'s event satisfies it. */
export interface FileChangeLogEvent {
  path: string;
  changeType: string;
  newPath?: string;
  timestamp: number;
}

/**
 * What the `file:changed` listener did with one event (D171): `other-path` — no open
 * document in this window has the path, dropped; `scheduled` — recorded, the active
 * document among the owners, its prompt waits out the debounce; `recorded` — recorded
 * for background documents only; `delivered` — a recorded change was presented.
 */
export type FileChangeReceivedOutcome =
  | "other-path"
  | "scheduled"
  | "recorded"
  | "delivered";

export interface FileChangeReceivedLogInput {
  event: FileChangeLogEvent;
  activePath: string | null;
  outcome: FileChangeReceivedOutcome;
  windowLabel: string;
  actionId: string;
}

export interface FileChangeDecisionLogInput {
  event: FileChangeLogEvent;
  activeDoc: Pick<Document, "id" | "path" | "isModified">;
  decision: FileChangeAction;
  windowLabel: string;
  actionId: string;
}

export const FILE_CHANGE_RECEIVED_EVENT = "file.change.received";
export const FILE_CHANGE_DECISION_EVENT = "file.change.decision";

function receivedStatus(outcome: FileChangeReceivedOutcome): LogStatus {
  switch (outcome) {
    case "other-path":
      return "cancel";
    case "scheduled":
    case "recorded":
      return "start";
    case "delivered":
      return "success";
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

function decisionStatus(action: FileChangeAction["action"]): LogStatus {
  switch (action) {
    case "reload-prompt":
    case "deleted-prompt":
    case "rename":
      return "success";
    case "ignore":
      return "cancel";
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

/**
 * Describe what the `file:changed` listener did with an event. `activePath` is
 * included only for `other-path`, the one outcome where it differs.
 */
export function buildFileChangeReceivedLog(input: FileChangeReceivedLogInput): LogEntryPayload {
  const { event, activePath, outcome, windowLabel, actionId } = input;
  return {
    level: "info",
    event: FILE_CHANGE_RECEIVED_EVENT,
    status: receivedStatus(outcome),
    actionId,
    context: {
      outcome,
      path: event.path,
      changeType: event.changeType,
      eventTimestamp: event.timestamp,
      windowLabel,
      ...(outcome === "other-path" ? { activePath } : {}),
    },
  };
}

/**
 * Describe the reload decision for an event against the active document.
 * `pathMatchesActive` is the same strict comparison `decideFileChange` makes;
 * `activePath` is included only when it is false.
 */
export function buildFileChangeDecisionLog(input: FileChangeDecisionLogInput): LogEntryPayload {
  const { event, activeDoc, decision, windowLabel, actionId } = input;
  const pathMatchesActive = event.path === activeDoc.path;
  return {
    level: "info",
    event: FILE_CHANGE_DECISION_EVENT,
    status: decisionStatus(decision.action),
    actionId,
    context: {
      action: decision.action,
      changeType: event.changeType,
      path: event.path,
      pathMatchesActive,
      isModified: activeDoc.isModified,
      documentId: activeDoc.id,
      windowLabel,
      eventTimestamp: event.timestamp,
      ...(pathMatchesActive ? {} : { activePath: activeDoc.path }),
    },
  };
}

/**
 * Dedupe key for the decision line: equal exactly when (timestamp, path,
 * changeType, activeDocId, action) are equal. Independent of object identity.
 */
export function decisionLogKey(
  event: FileChangeLogEvent,
  activeDocId: string | null,
  action: FileChangeAction["action"],
): string {
  return JSON.stringify([event.timestamp, event.path, event.changeType, activeDocId, action]);
}
