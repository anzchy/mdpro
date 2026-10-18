/**
 * Purpose: the one close commit both `useDocument` close paths share
 * (`closeActiveDocument`, `closeDocumentById`): send `close_document`, then
 * remove the document from the stores only if it is still the lifetime the
 * close began on.
 *
 * Key decisions:
 * - D261 H1 (audit round 1, PR #503): a reopened file comes back under the same
 *   path-derived id, so a reply held across close → reopen → typing used to
 *   remove the reopened document with its unsaved text. The re-check is D214's
 *   per-id baseline epoch (`baselineMovedSince`): `closeDocument` stamps it and
 *   the stamp only grows, so it tells two lifetimes of one id apart.
 * - Not the menu target token: a plain tab switch during the IPC would bump it
 *   and leave a tab whose backend close already ran.
 * - Accepted cost: `dropBaseline` also stamps the id (a failed save during the
 *   IPC), which refuses the commit too. The tab stays open and can be closed
 *   again; nothing is lost.
 *
 * @coordinates-with src/hooks/useDocument.ts — its two close paths call this
 * @coordinates-with src/stores/baselineEpoch.ts — the stamp read here
 * @module hooks/documentCloseCommit
 */
import { fileService } from "../services/fileService";
import { loggingService } from "../services/loggingService";
import { baselineMovedSince, useDocumentStore } from "../stores/documentStore";
import { useTOCStore } from "../stores/tocStore";

/**
 * Closes `id` in Rust, then in the stores iff its baseline epoch has not moved
 * since the IPC was sent. Resolves true when the stores removed it; false (and
 * one `file.close` cancel line, `reason:"stale"`) when a later lifetime owns the id.
 */
export async function commitDocumentClose(
  id: string,
  discardChanges: boolean,
  setEditorActiveDocumentId: (id: string | null) => void,
): Promise<boolean> {
  const start = useDocumentStore.getState().baselineGeneration;
  await fileService.closeDocument(id, discardChanges); // D173: holds go via watchHolds
  if (baselineMovedSince(id, start)) {
    loggingService.logEventSync({
      level: "info",
      event: "file.close",
      status: "cancel",
      actionId: loggingService.generateActionId(),
      context: { documentId: id, reason: "stale", stage: "close_commit" },
    });
    return false;
  }
  // WI-3.5.5 eviction: close→reopen returns the same path-derived id.
  useTOCStore.getState().resetCoordination(id);
  useDocumentStore.getState().closeDocument(id);
  // D96: follow the neighbour documentStore moved to, so the two stores agree.
  setEditorActiveDocumentId(useDocumentStore.getState().activeDocumentId);
  return true;
}
