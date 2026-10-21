/**
 * Purpose: place a recovered draft without overwriting a newer tab or draft (D146/D151,
 * ADR-0127). The claim-aware path uses Rust's exact target id and stored path, including
 * same-id and aliased-path matches. The older D146 helpers remain for legacy callers.
 *
 * Pipeline: Recover click captures the document set before the Rust await; Rust returns a
 * target and claim. After any collision-check await, placement re-reads that target and
 * checks its identity and baseline epoch. A clean target receives the text, marked dirty
 * with no saved baseline. A dirty, changed or protected target sends the text to a fresh
 * tab. With no target, the draft id is the destination unless a tab opened under that id
 * while Rust was waiting. Every branch writes the destination with the claim before the
 * dialog row resolves. Only a different destination id gets a conditional source delete.
 * A failed write keeps the source and row and shows a retry toast.
 *
 * The legacy path without a claim preserves D146/D151's original behavior for older
 * call sites. Both paths flush pending WYSIWYG edits before replacing an open tab.
 *
 * @coordinates-with src/App.tsx — applies the outcome and removes the row after success
 * @coordinates-with src/services/draftService.ts — captures click-time target identity
 * @coordinates-with src/stores/documentStore.ts — baseline and document lifetime
 * @coordinates-with src-tauri/src/services/draft/mod.rs — claim write and source delete
 * @module utils/recoverIntoOpenTab
 */
import { invoke } from "@tauri-apps/api/core";
import { loggingService } from "../services/loggingService";
import { recoveryStartGeneration, recoveryTargetUnchanged, type RecoverResult } from "../services/draftService";
import { baselineMovedSince, useDocumentStore } from "../stores/documentStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import type { Document } from "../types/document";
import { extractTitle } from "./draftTitle";
import { recoveryPlacementCommitted, recoveryPlacementFailed, recoveryPlacementStarted, recoveryWillActivate } from "./recoveryPlacementFocus";

/** Whether a draft is stored under the open tab's id (D151): `get_draft`'s answer. */
export type DraftUnderOpenId = "absent" | "present" | "check-failed";

/** The id `get_draft` was asked about and its answer. */
export interface OpenIdDraftCheck {
  id: string;
  state: DraftUnderOpenId;
}

export type RecoverPlacement =
  | { kind: "merged-into-clean"; document: Document }
  | { kind: "collision-dirty"; document: Document; open: Document }
  | { kind: "collision-existing-draft"; document: Document; open: Document }
  | { kind: "collision-draft-check-failed"; document: Document; open: Document }
  | { kind: "new"; document: Document };

type CollisionKind = Exclude<RecoverPlacement["kind"], "merged-into-clean" | "new">;

export interface RecoverIntoStoreDeps {
  /** `useDocument().upsertAndActivateDocument`: wholesale prep, upsert, activate. */
  upsertAndActivate: (document: Document) => void;
  showToast: (message: string) => void;
}

const fileName = (path: string): string => path.split(/[/\\]/).pop() || path;

/** The toast for a draft recovered next to a dirty tab of the same file. */
export const collisionToast = (path: string): string =>
  `A recovered draft and an unsaved edit of ${fileName(path)} are both open.`;

/** The toast for a recovered draft kept in its own tab: another draft of the file waits (D151). */
export const existingDraftToast = (path: string): string =>
  "Another unsaved draft of " +
  `${fileName(path)} is still waiting to be recovered, so this one opened in its own tab.`;

/** The toast for a draft opened in its own tab because the check for another draft failed. */
export const draftCheckFailedToast = (path: string): string =>
  "Could not check for another unsaved draft of " +
  `${fileName(path)}, so this one opened in its own tab.`;

const TOASTS: Record<CollisionKind, (path: string) => string> = {
  "collision-dirty": collisionToast,
  "collision-existing-draft": existingDraftToast,
  "collision-draft-check-failed": draftCheckFailedToast,
};

/** The open tab sharing `recovered`'s non-null path under another id, if any. */
function findOpenMatch(recovered: Document): Document | undefined {
  const { path } = recovered;
  if (path === null) return undefined;
  return useDocumentStore
    .getState()
    .documents.find((doc) => doc.id !== recovered.id && doc.path === path);
}

/**
 * Ask `get_draft` whether a draft is stored under `id`. `null` (Rust `None`) is absent;
 * a rejection is `check-failed`, which callers treat like `present`. Never rejects.
 */
export async function checkDraftUnder(id: string): Promise<OpenIdDraftCheck> {
  try {
    const draft = await invoke<unknown>("get_draft", { documentId: id });
    return { id, state: draft == null ? "absent" : "present" };
  } catch {
    return { id, state: "check-failed" };
  }
}

/**
 * Where `recovered` (under its draft id) goes, given `check`: what `get_draft` said
 * about the matching tab's id. A check about another id (the tab changed while it ran)
 * counts as failed. Flushes the matching tab's pending WYSIWYG edits before judging it;
 * reads nothing else and writes no document.
 */
export function placeRecovered(recovered: Document, check?: OpenIdDraftCheck): RecoverPlacement {
  const match = findOpenMatch(recovered);
  if (!match) return { kind: "new", document: recovered };
  const { status } = useMilkdownEditorStore
    .getState()
    .flushPendingEditsFor(match.id, "draft-recovery");
  const open = useDocumentStore.getState().getDocumentById(match.id) ?? match;
  if (status === "failed" || open.isModified) {
    return { kind: "collision-dirty", document: recovered, open };
  }
  const draftState = check?.id === match.id ? check.state : "check-failed";
  if (draftState === "present") {
    return { kind: "collision-existing-draft", document: recovered, open };
  }
  if (draftState === "check-failed") {
    return { kind: "collision-draft-check-failed", document: recovered, open };
  }
  return {
    kind: "merged-into-clean",
    // D214: the draft's text is not on disk, so the tab loses its baseline (sticky dirty).
    document: { ...open, content: recovered.content, isModified: true, savedContent: undefined },
  };
}

function logMerge(draftId: string, documentId: string, outcome: RecoverPlacement["kind"]) {
  loggingService.logEventSync({
    level: outcome === "merged-into-clean" ? "info" : "warn",
    event: "file.draft.recover.merge",
    status: "success",
    actionId: loggingService.generateActionId(),
    context: { draftId, documentId, outcome },
  });
}

function logRekey(draftId: string, documentId: string, stage?: "save_draft" | "delete_draft") {
  loggingService.logEventSync({
    level: stage ? "warn" : "info",
    event: "file.draft.rekey",
    status: stage ? "fail" : "success",
    actionId: loggingService.generateActionId(),
    context: stage ? { draftId, documentId, stage } : { draftId, documentId },
  });
}

/** Move the recovered draft from `draftId` to the merged tab's id; never rejects. */
async function rekeyDraft(draftId: string, merged: Document): Promise<void> {
  try {
    await invoke("save_draft", {
      documentId: merged.id,
      content: merged.content,
      originalPath: merged.path,
      title: extractTitle(merged.content),
    });
  } catch {
    logRekey(draftId, merged.id, "save_draft");
    return;
  }
  try {
    await invoke("delete_draft", { documentId: draftId });
  } catch {
    logRekey(draftId, merged.id, "delete_draft");
    return;
  }
  logRekeyDelete(draftId, merged);
  logRekey(draftId, merged.id);
}

/**
 * The audit line for the one draft deletion outside the recovery dialog (D146 WI-2):
 * which draft went, why, where its text now lives and how many UTF-8 bytes moved.
 */
function logRekeyDelete(draftId: string, merged: Document) {
  loggingService.logEventSync({
    level: "info",
    event: "file.draft.delete",
    status: "success",
    actionId: loggingService.generateActionId(),
    context: {
      draftId,
      reason: "rekeyed",
      rekeyedTo: merged.id,
      bytes: new TextEncoder().encode(merged.content).length,
    },
  });
}

/**
 * Put the recovered document in the store, then, after a merge, re-key its draft.
 * With no open tab of the same path this is synchronous, before the first await; with
 * one, it first awaits `get_draft` under that tab's id (D151), then places and writes
 * the store in one synchronous step. Resolves when the re-key settles.
 */
export async function applyRecoveredDocument(
  draftId: string,
  recovered: Document,
  deps: RecoverIntoStoreDeps,
  recovery?: RecoverResult,
): Promise<RecoverPlacement["kind"] | "failed"> {
  if (recovery?.claimToken) {
    return applyClaimedRecoveredDocument(draftId, recovered, deps, recovery);
  }
  recoveryPlacementStarted(draftId);
  let placement: RecoverPlacement;
  try {
    const match = findOpenMatch(recovered);
    const check = match ? await checkDraftUnder(match.id) : undefined;
    placement = placeRecovered(recovered, check);
    recoveryWillActivate(draftId, placement.document.id);
    deps.upsertAndActivate(placement.document);
    recoveryPlacementCommitted(draftId, placement.document.id);
  } catch {
    recoveryPlacementFailed(draftId);
    deps.showToast("Failed to recover draft");
    return "failed";
  }
  switch (placement.kind) {
    case "new":
      return placement.kind;
    case "collision-dirty":
    case "collision-existing-draft":
    case "collision-draft-check-failed":
      logMerge(draftId, placement.open.id, placement.kind);
      deps.showToast(TOASTS[placement.kind](placement.open.path ?? ""));
      return placement.kind;
    case "merged-into-clean":
      logMerge(draftId, placement.document.id, placement.kind);
      await rekeyDraft(draftId, placement.document);
      return placement.kind;
  }
}

/** ADR-0127: use Rust's target id, then make every branch durable with its claim. */
async function applyClaimedRecoveredDocument(
  draftId: string,
  recovered: Document,
  deps: RecoverIntoStoreDeps,
  recovery: RecoverResult,
): Promise<RecoverPlacement["kind"] | "failed"> {
  const token = recovery.claimToken;
  if (!token) return "failed";
  recoveryPlacementStarted(draftId);
  const target = recovery.target;
  const started = recoveryStartGeneration(recovery);
  let check: OpenIdDraftCheck | undefined;
  if (target && target.id !== draftId) check = await checkDraftUnder(target.id);

  let kind: RecoverPlacement["kind"] = "new";
  let next = recovered;
  let open: Document | undefined;
  if (!target) {
    // Rust saw no tab, but one can open under the source id while the IPC awaits.
    open = useDocumentStore.getState().getDocumentById(draftId);
    if (open) {
      kind = "collision-dirty";
      next = { ...recovered, id: crypto.randomUUID() };
    }
  }
  if (target) {
    open = useDocumentStore.getState().getDocumentById(target.id);
    const stale = !open || open.path !== target.storedPath
      || !recoveryTargetUnchanged(recovery, target.id)
      || baselineMovedSince(target.id, started);
    if (!stale && open) {
      const { status } = useMilkdownEditorStore.getState().flushPendingEditsFor(open.id, "draft-recovery");
      open = useDocumentStore.getState().getDocumentById(target.id);
      if (!open || status === "failed" || open.isModified) {
        kind = "collision-dirty";
      } else if (check?.state === "present") {
        kind = "collision-existing-draft";
      } else if (check?.state === "check-failed") {
        kind = "collision-draft-check-failed";
      } else {
        kind = "merged-into-clean";
        next = { ...open, content: recovered.content, isModified: true, savedContent: undefined };
      }
    } else {
      kind = "collision-dirty";
    }
    if (kind !== "merged-into-clean") {
      next = { ...recovered, id: crypto.randomUUID() };
    }
  }

  recoveryWillActivate(draftId, next.id);
  deps.upsertAndActivate(next);
  const placedAtWrite = useDocumentStore.getState().getDocumentById(next.id);
  const writeClaimed = (document: Document) => invoke("save_draft", {
    documentId: document.id,
    content: document.content,
    originalPath: document.path,
    title: extractTitle(document.content),
    claimToken: token,
  });
  try {
    await writeClaimed(next);
    if (useDocumentStore.getState().getDocumentById(next.id) !== placedAtWrite) {
      // A close, reload or newer edit won while the write awaited. Keep R under
      // a new id before allowing the source claim to be deleted.
      next = { ...recovered, id: crypto.randomUUID() };
      kind = "collision-dirty";
      recoveryWillActivate(draftId, next.id);
      deps.upsertAndActivate(next);
      await writeClaimed(next);
    }
    if (next.id !== draftId) {
      await invoke("delete_draft", { documentId: draftId, claimToken: token });
    }
  } catch {
    recoveryPlacementFailed(draftId);
    deps.showToast("Could not finish recovering the draft; please retry.");
    return "failed";
  }

  recoveryPlacementCommitted(draftId, next.id);
  if (kind !== "new" && kind !== "merged-into-clean") {
    deps.showToast(open?.path ? TOASTS[kind](open.path) : "The open tab changed, so the recovered draft opened in its own tab.");
  }
  logMerge(draftId, next.id, kind);
  return kind;
}
