/** Delete each explicitly discarded window draft; one failure cannot skip later IDs. */
import { invoke } from "@tauri-apps/api/core";
import { loggingService } from "./loggingService";
import { forgetDraftRevision, lastSavedDraftRevision } from "./draftWriteCoordinator";

export async function deleteDiscardedDrafts(documentIds: Iterable<string>, stillConsented: () => boolean): Promise<boolean> {
  for (const documentId of documentIds) {
    if (!stillConsented()) return false;
    const expectedRevision = lastSavedDraftRevision(documentId);
    if (!expectedRevision) continue;
    const actionId = loggingService.generateActionId();
    loggingService.logEventSync({ level: "info", event: "draft.discard", status: "start", actionId });
    try {
      const outcome = await invoke<"deleted" | "absent" | "protected" | "stale">("delete_discarded_draft", { documentId, expectedRevision });
      if (outcome === "stale") {
        loggingService.logEventSync({ level: "warn", event: "draft.discard", status: "cancel", actionId, context: { reason: "stale" } });
        return false;
      }
      if (outcome === "deleted" || outcome === "absent") forgetDraftRevision(documentId);
      loggingService.logEventSync({ level: "info", event: "draft.discard", status: "success", actionId });
    } catch {
      loggingService.logEventSync({ level: "warn", event: "draft.discard", status: "fail", actionId, context: { reason: "delete_failed" } });
    }
    if (!stillConsented()) return false;
  }
  return true;
}
