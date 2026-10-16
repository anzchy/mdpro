/**
 * Purpose: the body of the reload prompt's Reload button (`App.handleReloadFile`):
 * re-read the file from disk and replace the content of the document the prompt was
 * about, in place, under THAT document's id (D138).
 *
 * Pipeline: event path → target = the active document whose `path` equals it (or
 *   none → `no-target`, logged, nothing read) → `reload_file` → target re-read by id
 *   (closed or moved meanwhile → `no-target`) → `reloadedInPlace(target, reloaded)` →
 *   `replaceDocument` (`prepareWholesaleReplace(target.id, "file-reload")` + upsert)
 *   → `file.reload` logged.
 *
 * Key decisions:
 * - The store key is the target's id, never the reload result's. `reload_file` answers
 *   under the path-derived id, but a document that started Untitled keeps its UUID
 *   through Save As; upserting the result added a duplicate tab, and a later ⌘S in the
 *   stale original overwrote the external edit the user had just reloaded (D138).
 * - The target is the ACTIVE document with that path: the prompt is only shown for
 *   the active document (D171 records changes for every open document but presents
 *   the active one's). When none matches (the tab was closed or switched) nothing is
 *   read and nothing is written.
 * - The target is re-read after the await: a tab closed during `reload_file` is not
 *   resurrected. A tab switch during the await still reloads the target (by id).
 * - The store write stays in `useDocument.replaceDocument`, the one file-reload upsert
 *   site `tests/wholesale-path-partition.test.ts` classifies; this module only decides
 *   what is written.
 * - A failed `reload_file` is logged and rethrown; the caller toasts.
 * - D214-WI-5/6: `baselineGeneration` is captured before `reload_file`. If the
 *   target's baseline moved since (`baselineMovedSince`: an external change during the
 *   read, or a close and reopen under the same id), the reloaded
 *   bytes go in dirty with no baseline (`savedContent: undefined`) instead of clean,
 *   and the success log carries `demoted: true, reason: "external_change_during_reload"`.
 *   Nothing here acknowledges a change, so the newer one's prompt stays pending.
 * - Logs carry ids and enums only, never the path: `file.reload` success / fail with
 *   `documentId` (and `reloadedId` when the result's id differs), cancel with
 *   `reason: "no-target"`.
 *
 * @coordinates-with src/hooks/useExternalChangePrompt.ts — handleReloadFile calls reloadActiveFromDisk
 * @coordinates-with src/hooks/useDocument.ts — replaceDocument (the store write)
 * @coordinates-with src/services/fileService.ts — reloadFile (`reload_file`)
 * @module utils/reloadTarget
 */
import { fileService } from "../services/fileService";
import { loggingService } from "../services/loggingService";
import { baselineMovedSince, useDocumentStore } from "../stores/documentStore";
import type { Document } from "../types/document";

export type ReloadOutcome = { kind: "reloaded"; documentId: string } | { kind: "no-target" };

/**
 * The document to store for a reload of `target`: the reloaded bytes and metadata
 * (content, encoding, line ending, path, saved time, size), clean, under `target.id`.
 */
export function reloadedInPlace(target: Document, reloaded: Document): Document {
  return { ...reloaded, id: target.id, isModified: false };
}

function activeWithPath(path: string): Document | undefined {
  const { documents, activeDocumentId } = useDocumentStore.getState();
  return documents.find((doc) => doc.id === activeDocumentId && doc.path === path);
}

function logReload(
  status: "success" | "fail" | "cancel",
  actionId: string,
  context: Record<string, unknown>,
): void {
  loggingService.logEventSync({
    level: status === "fail" ? "error" : "info",
    event: "file.reload",
    status,
    actionId,
    context,
  });
}

/**
 * Reload the active document whose path is `path` from disk, in place (D138).
 * Rejects with `reload_file`'s error, after logging it. If the baseline moved during
 * the read (an external change, or a close and reopen), the result goes in dirty with
 * no baseline (D214-WI-5/6).
 */
export async function reloadActiveFromDisk(
  path: string,
  replaceDocument: (document: Document) => void,
  actionId: string = loggingService.generateActionId(),
): Promise<ReloadOutcome> {
  const target = activeWithPath(path);
  if (!target) {
    logReload("cancel", actionId, { reason: "no-target" });
    return { kind: "no-target" };
  }
  const startGeneration = useDocumentStore.getState().baselineGeneration; // D214-WI-6
  let reloaded: Document;
  try {
    reloaded = await fileService.reloadFile(path);
  } catch (error) {
    // The error text can name the path, so only the id is logged; the caller toasts.
    logReload("fail", actionId, { documentId: target.id });
    throw error;
  }
  const current = useDocumentStore.getState().getDocumentById(target.id);
  if (!current || current.path !== path) {
    logReload("cancel", actionId, { reason: "no-target", documentId: target.id });
    return { kind: "no-target" };
  }
  // D214-WI-5/6: a change (or close) during the read: the bytes may already be stale, so
  // they go in dirty with no baseline; the newer change's prompt stays pending.
  const overtaken = baselineMovedSince(target.id, startGeneration);
  const next = reloadedInPlace(current, reloaded);
  replaceDocument(overtaken ? { ...next, isModified: true, savedContent: undefined } : next);
  logReload("success", actionId, {
    documentId: target.id,
    ...(reloaded.id !== target.id ? { reloadedId: reloaded.id } : {}),
    ...(overtaken ? { demoted: true, reason: "external_change_during_reload" } : {}),
  });
  return { kind: "reloaded", documentId: target.id };
}
