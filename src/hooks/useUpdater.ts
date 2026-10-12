import { useDocumentStore } from "../stores/documentStore";
import { useToastStore } from "../stores/toastStore";
import { fileService } from "../services/fileService";
import { loggingService } from "../services/loggingService";
import { assessWindowUnsaved } from "../utils/dataLossGuards";
import { saveBlockedByPendingChange } from "../utils/externalChangeGuard";
import type { Document } from "../types/document";

/**
 * Purpose: App-level coordinator for pre-relaunch save guard.
 * Flushes pending WYSIWYG edits FIRST via `assessWindowUnsaved("relaunch")`
 * (D16 WI-8 / ADR-0025) — the relaunch, window-close and quit paths share one
 * unsaved-changes rule — then saves every document the flush left modified,
 * using the content the flush wrote into documentStore. Blocks relaunch when
 * the flush failed, when a dirty document is untitled, when a dirty document has
 * an unresolved external change (D171), or when a save fails.
 *
 * Reading `isModified` without flushing first would answer "clean" for an edit
 * still inside the edit-sync delay and silently discard it at relaunch.
 *
 * @coordinates-with src/utils/dataLossGuards.ts — assessWindowUnsaved
 * @coordinates-with src/stores/milkdownEditorStore.ts — the flusher registry
 * @coordinates-with src/utils/externalChangeGuard.ts — the pending-change check (D171)
 */
export async function prepareForRelaunch(): Promise<boolean> {
  const actionId = loggingService.generateActionId();

  // Flush first, then read. Order is the whole point of this guard.
  const assessment = assessWindowUnsaved("relaunch");

  if (assessment.flushFailed) {
    useToastStore
      .getState()
      .showToast("Could not capture the latest editor changes. Update cancelled.");
    loggingService.logEventSync({
      level: "error",
      event: "updater.prepare_relaunch",
      status: "fail",
      actionId,
      context: { reason: "flush_failed" },
    });
    return false;
  }

  if (assessment.dirtyDocuments.length === 0) return true;

  // The post-flush store, read once: `dirtyDocuments` carries metadata only, so
  // the content comes from the same synchronous read the assessment used.
  const byId = new Map(
    useDocumentStore.getState().documents.map((doc) => [doc.id, doc] as const),
  );
  const modified = assessment.dirtyDocuments
    .map((ref) => byId.get(ref.id))
    .filter((doc): doc is Document => doc !== undefined);

  loggingService.logEventSync({
    level: "info",
    event: "updater.prepare_relaunch",
    status: "start",
    actionId,
    context: { modifiedCount: modified.length },
  });

  // Untitled blocks before any write: the relaunch is already cancelled, so
  // there is no reason to push surprise writes to the other tabs' files.
  const untitled = modified.find((doc) => !doc.path);
  if (untitled) {
    useToastStore.getState().showToast(
      `"Untitled" has unsaved changes. Save it before updating.`,
    );
    loggingService.logEventSync({
      level: "warn",
      event: "updater.prepare_relaunch",
      status: "fail",
      actionId,
      context: { reason: "untitled_document", documentId: untitled.id },
    });
    return false;
  }

  // D171: a dirty document with an unresolved external change is not written over.
  const changed = modified.find((doc) => saveBlockedByPendingChange(doc.id, "relaunch", actionId));
  if (changed) {
    useToastStore.getState().showToast(
      "A file changed on disk. Reload or ignore that change before updating.",
    );
    loggingService.logEventSync({
      level: "warn",
      event: "updater.prepare_relaunch",
      status: "fail",
      actionId,
      context: { reason: "pending_external_change", documentId: changed.id },
    });
    return false;
  }

  for (const doc of modified) {
    const path = doc.path as string;
    try {
      await fileService.saveFile({
        documentId: doc.id,
        content: doc.content,
        path,
        encoding: doc.encoding,
        lineEnding: doc.lineEnding,
        actionId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useToastStore.getState().showToast(
        `Failed to save "${path.split("/").pop()}". Update cancelled.`,
      );
      loggingService.logEventSync({
        level: "error",
        event: "updater.prepare_relaunch",
        status: "fail",
        actionId,
        context: { reason: "save_failed", documentId: doc.id, error: msg },
      });
      return false;
    }
  }

  loggingService.logEventSync({
    level: "info",
    event: "updater.prepare_relaunch",
    status: "success",
    actionId,
    context: { savedCount: modified.length },
  });
  return true;
}
