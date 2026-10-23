/** Delete each explicitly discarded window draft; one failure cannot skip later IDs. */
import { invoke } from "@tauri-apps/api/core";
import { loggingService } from "./loggingService";

export async function deleteDiscardedDrafts(documentIds: Iterable<string>, stillConsented: () => boolean): Promise<boolean> {
  for (const documentId of documentIds) {
    if (!stillConsented()) return false;
    const actionId = loggingService.generateActionId();
    loggingService.logEventSync({ level: "info", event: "draft.discard", status: "start", actionId });
    try {
      await invoke<boolean>("delete_discarded_draft", { documentId });
      loggingService.logEventSync({ level: "info", event: "draft.discard", status: "success", actionId });
    } catch {
      loggingService.logEventSync({ level: "warn", event: "draft.discard", status: "fail", actionId, context: { reason: "delete_failed" } });
    }
    if (!stillConsented()) return false;
  }
  return true;
}
