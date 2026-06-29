import { useDocumentStore } from "../stores/documentStore";
import { useToastStore } from "../stores/toastStore";
import { fileService } from "../services/fileService";
import { loggingService } from "../services/loggingService";

/**
 * Purpose: App-level coordinator for pre-relaunch save guard.
 * Iterates all modified documents, saves each with a path,
 * blocks relaunch for untitled or failed saves.
 */
export async function prepareForRelaunch(): Promise<boolean> {
  const { documents } = useDocumentStore.getState();
  const modified = documents.filter((d) => d.isModified);

  if (modified.length === 0) return true;

  const actionId = loggingService.generateActionId();
  loggingService.logEventSync({
    level: "info",
    event: "updater.prepare_relaunch",
    status: "start",
    actionId,
    context: { modifiedCount: modified.length },
  });

  for (const doc of modified) {
    if (!doc.path) {
      useToastStore.getState().showToast(
        `"Untitled" has unsaved changes. Save it before updating.`,
      );
      loggingService.logEventSync({
        level: "warn",
        event: "updater.prepare_relaunch",
        status: "fail",
        actionId,
        context: { reason: "untitled_document", documentId: doc.id },
      });
      return false;
    }

    try {
      await fileService.saveFile({
        documentId: doc.id,
        content: doc.content,
        path: doc.path,
        encoding: doc.encoding,
        lineEnding: doc.lineEnding,
        actionId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useToastStore.getState().showToast(
        `Failed to save "${doc.path.split("/").pop()}". Update cancelled.`,
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
