/**
 * Purpose: the two save bodies (Save, Save As) for one document, run through a
 * per-document queue so saves of the same document never overlap (D70).
 *
 * Pipeline: `saveActiveDocument` / `saveActiveDocumentAs` take the active document's
 *   id → `runSerializedSave(id)` waits for that document's earlier saves → flush and
 *   read the document by id (`flushDocumentForSave`) → [get_preferences] → save IPC
 *   → `applySaveResult` → the next queued save of that document starts.
 *
 * Key decisions:
 * - The queue spans snapshot capture to apply. ⌘S → type → ⌘S used to put two
 *   saves in flight; when the older `save_file` landed last, disk held the older
 *   text while the store said "saved" (D70). Now the second save starts after the
 *   first has applied, and writes the content current at that point.
 * - The key is the document id taken when the save is requested. A queued save
 *   writes that document even if another tab became active meanwhile, and does
 *   nothing (returns `null`) if the document was closed while it waited.
 * - Save and Save As of one document share a queue (both rewrite its path and dirty
 *   state); different documents never wait for each other.
 * - A failed save settles the queue like a successful one, so it cannot wedge it.
 * - A queued save logs `file.save.queued` (document id and actionId only).
 * - D171: right before `save_file` the Save body asks `saveBlockedByPendingChange`; with
 *   an unresolved external change it writes nothing and throws
 *   `ExternalChangePendingError` (performSave toasts it; the document stays dirty and its
 *   reload prompt shows). Save As is not checked: it writes where the user chose.
 *
 * @coordinates-with src/hooks/useDocument.ts — exposes these as the hook's save API
 * @coordinates-with src/services/saveService.ts — flushDocumentForSave, applySaveResult
 * @coordinates-with src/utils/externalChangeGuard.ts — the pending-change check (D171)
 * @module services/documentSave
 */
import { useDocumentStore } from "../stores/documentStore";
import { makeIsFenced } from "../utils/fenceRanges";
import { ExternalChangePendingError, saveBlockedByPendingChange } from "../utils/externalChangeGuard";
import { formatAllTables } from "../utils/tableFormatter";
import { fileService, type SaveResult } from "./fileService";
import { loggingService } from "./loggingService";
import { preferencesService } from "./preferencesService";
import { applySaveResult, flushDocumentForSave } from "./saveService";

/** Tail of each document's save queue; settles (never rejects) when its last save ends. */
const saveQueues = new Map<string, Promise<void>>();

/**
 * Run `task` (one whole save of `documentId`) after every earlier save of the same
 * document has finished (D70).
 *
 * With nothing queued the task starts synchronously, as before. A queued task logs
 * `file.save.queued` and starts after the previous one settles, success or failure.
 * The returned promise is the task's own, so its result and rejection reach the caller.
 */
function runSerializedSave<T>(
  documentId: string,
  actionId: string | undefined,
  task: () => Promise<T>,
): Promise<T> {
  const previous = saveQueues.get(documentId);
  if (previous) {
    loggingService.logEventSync({
      level: "info",
      event: "file.save.queued",
      status: "start",
      actionId: actionId ?? loggingService.generateActionId(),
      context: { documentId },
    });
  }
  const run = previous ? previous.then(task) : (async () => task())();
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  saveQueues.set(documentId, tail);
  void tail.then(() => {
    if (saveQueues.get(documentId) === tail) saveQueues.delete(documentId);
  });
  return run;
}

const getTitleFromPath = (path: string | null) => {
  if (!path) return "Untitled";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "Untitled";
};

// D15: both bodies flush pending WYSIWYG edits and then read the document from the
// store, never a render-time closure. A failed flush throws (caught by performSave as
// "Save failed: …"), so no save IPC runs and the doc stays dirty.
// D19: after the await, neither body writes its pre-await snapshot back. On success
// `applySaveResult` re-reads the store: an edit made during the save stays dirty and
// keeps its draft, and a document closed during the save is not resurrected.

/** Save As body for `documentId`. The caller holds the document's queue slot. */
async function saveDocumentAsNow(documentId: string, actionId?: string): Promise<SaveResult | null> {
  const doc = flushDocumentForSave(documentId, actionId);
  if (!doc) return null;
  const result = await fileService.saveFileDialog({
    documentId: doc.id,
    content: doc.content,
    suggestedName: getTitleFromPath(doc.path),
    encoding: doc.encoding,
    lineEnding: doc.lineEnding,
    actionId,
  });
  if (result?.success) {
    applySaveResult(doc.id, doc.content, doc.content, result, actionId);
  }
  return result;
}

/** Save body for `documentId` (Save As when untitled). The caller holds the queue slot. */
async function saveDocumentNow(documentId: string, actionId?: string): Promise<SaveResult | null> {
  const doc = flushDocumentForSave(documentId, actionId);
  if (!doc) return null;
  if (!doc.path) {
    return saveDocumentAsNow(documentId, actionId);
  }
  // Phase 3 WI-3.2: optional auto-reformat-on-save (off by default). Disk gets the
  // formatted text; the store gets it too unless the doc was edited during the save
  // (D19, applySaveResult). Audit-fix H3: isFenced keeps ``` blocks from being
  // rewritten as tables.
  let contentToSave = doc.content;
  try {
    const prefs = await preferencesService.getPreferences("save_reformat_check");
    if (prefs.markdown?.autoReformatTablesOnSave) {
      contentToSave = formatAllTables(doc.content, makeIsFenced(doc.content));
      if (contentToSave !== doc.content) {
        loggingService.logEventSync({
          level: "info",
          event: "editor.table.auto-reformat-on-save",
          status: "success",
          actionId: actionId ?? loggingService.generateActionId(),
          context: { documentId: doc.id },
        });
      }
    }
  } catch {
    // Preference read failed — fall through with original content.
  }
  // D171: checked here, at the write, not at ⌘S — a change recorded while this save
  // waited (queue, get_preferences) must stop it too.
  if (saveBlockedByPendingChange(doc.id, "save", actionId)) throw new ExternalChangePendingError();
  const result = await fileService.saveFile({
    documentId: doc.id,
    content: contentToSave,
    path: doc.path,
    encoding: doc.encoding,
    lineEnding: doc.lineEnding,
    actionId,
  });
  if (result?.success) {
    applySaveResult(doc.id, doc.content, contentToSave, result, actionId);
  }
  return result;
}

/** Save the active document, after any earlier save of it has finished (D70). */
export function saveActiveDocument(actionId?: string): Promise<SaveResult | null> {
  const id = useDocumentStore.getState().activeDocumentId;
  if (!id) return Promise.resolve(null);
  return runSerializedSave(id, actionId, () => saveDocumentNow(id, actionId));
}

/** Save the active document under a new path, queued like `saveActiveDocument` (D70). */
export function saveActiveDocumentAs(actionId?: string): Promise<SaveResult | null> {
  const id = useDocumentStore.getState().activeDocumentId;
  if (!id) return Promise.resolve(null);
  return runSerializedSave(id, actionId, () => saveDocumentAsNow(id, actionId));
}
