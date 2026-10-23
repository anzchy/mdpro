/**
 * Purpose: activate the most recently used other document in this window.
 * @coordinates-with src/stores/tabStore.ts — ranks activations
 * @coordinates-with src/stores/documentStore.ts — refuses a failed editor flush
 * @coordinates-with src/stores/editorStore.ts — follows only an accepted switch
 */
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";
import { useTabStore } from "../stores/tabStore";

export function switchToMostRecentDocument(actionId?: string): void {
  const documents = useDocumentStore.getState();
  const tabs = useTabStore.getState();
  tabs.syncDocuments(documents.documents, documents.activeDocumentId);
  const target = useTabStore.getState().mostRecentOtherTab();
  const id = actionId ?? loggingService.generateActionId();
  if (!target) {
    loggingService.logEventSync({
      level: "info", event: "tab.switch", status: "cancel", actionId: id,
      context: { reason: "one_tab" },
    });
    return;
  }
  if (!useDocumentStore.getState().setActiveDocumentId(target.documentId)) return;
  useEditorStore.getState().setActiveDocumentId(target.documentId);
  useTabStore.getState().switchToTab(target.id);
}
