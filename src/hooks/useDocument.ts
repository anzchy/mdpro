import { useCallback, useMemo, useState } from "react";
import { fileService } from "../services/fileService";
import { preferencesService } from "../services/preferencesService";
import { applySaveResult, flushActiveDocumentForSave } from "../services/saveService";
import type { Document } from "../types/document";
import { useDocumentStore } from "../stores/documentStore";
import { useTOCStore } from "../stores/tocStore";
import { prepareWholesaleReplace } from "../utils/wholesaleReplace";
import { loggingService } from "../services/loggingService";
import { useEditorStore } from "../stores/editorStore";
import { formatAllTables } from "../utils/tableFormatter";
import { makeIsFenced } from "../utils/fenceRanges";
import {
  commitOpenedDocument,
  focusDirtyOpenAt,
  type EncodingReopenResult,
  type OpenWriteResult,
} from "../utils/openWriteGuard";
import { parseEncodingError, reportOpenFailure } from "../utils/openFailure";

const createEmptyDocument = (): Document => ({
  id:
    globalThis.crypto?.randomUUID?.() ??
    `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  path: null,
  content: "",
  encoding: "UTF-8",
  lineEnding: "lf",
  isModified: false,
  lastSaved: null,
  fileSize: null,
});

const getTitleFromPath = (path: string | null) => {
  if (!path) return "Untitled";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "Untitled";
};

const LARGE_FILE_WARNING = "Large file opened (>10MB). Performance may be affected.";

export function useDocument() {
  const documents = useDocumentStore((s) => s.documents);
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId);
  const setEditorActiveDocumentId = useEditorStore((state) => state.setActiveDocumentId);
  const [largeFileWarning, setLargeFileWarning] = useState<string | null>(null);
  const [encodingIssue, setEncodingIssue] = useState<{
    path: string;
    detected: string;
  } | null>(null);

  const activeDocument = useMemo(
    () => documents.find((doc) => doc.id === activeDocumentId) ?? null,
    [documents, activeDocumentId],
  );

  /** Set the large-file warning for a written open, and hand back the document. */
  const applyOpened = useCallback((outcome: OpenWriteResult): Document => {
    if (outcome.kind === "written" && outcome.largeFile) setLargeFileWarning(LARGE_FILE_WARNING);
    return outcome.document;
  }, []);

  // D20 / ADR-0028: every open writes through `commitOpenedDocument` AFTER the read's
  // await; a dirty target (checked after a "reopen" flush) is focused, never replaced,
  // and returned so callers still record the path. The decode-failure exit focuses a
  // dirty open doc via `focusDirtyOpenAt` before it would show EncodingDialog.
  // D46: any other failure (e.g. FileTooLarge) gets the ⌘O toast and a path-free log
  // from `reportOpenFailure`, then returns null; no caller adds a toast of its own.
  const openDocumentFromPath = useCallback(
    async (path: string, actionId?: string) => {
      try {
        const result = await fileService.openFile(path, undefined, actionId);
        return applyOpened(commitOpenedDocument(result.document, "file-open", { actionId }));
      } catch (error) {
        const encodingError = parseEncodingError(error);
        if (encodingError) {
          const focused = focusDirtyOpenAt(encodingError.path || path, { actionId });
          if (focused) return focused;
          setEncodingIssue({
            path: encodingError.path || path,
            detected: encodingError.detected || "unknown",
          });
        } else {
          reportOpenFailure(error, actionId);
        }
        return null;
      }
    },
    [applyOpened],
  );

  const setActiveDocumentById = useCallback(
    (id: string) => {
      useDocumentStore.getState().setActiveDocumentId(id);
      setEditorActiveDocumentId(id);
    },
    [setEditorActiveDocumentId],
  );

  const openDocumentFromDialog = useCallback(async (actionId?: string) => {
    try {
      const result = await fileService.openFileDialog(actionId);
      if (!result) {
        return null;
      }
      return applyOpened(commitOpenedDocument(result.document, "file-open", { actionId }));
    } catch (error) {
      const encodingError = parseEncodingError(error);
      if (encodingError) {
        const focused = focusDirtyOpenAt(encodingError.path, { actionId });
        if (focused) return focused;
        setEncodingIssue({
          path: encodingError.path || "",
          detected: encodingError.detected || "unknown",
        });
      } else {
        // Re-throw non-encoding errors so the caller can handle them
        throw error;
      }
      return null;
    }
  }, [applyOpened]);

  /** Re-decode under `encoding`; a dirty target is refused (kept and focused), not replaced. */
  const openDocumentWithEncoding = useCallback(
    async (path: string, encoding: string, actionId?: string): Promise<EncodingReopenResult> => {
      const result = await fileService.openFile(path, encoding, actionId);
      const outcome = commitOpenedDocument(result.document, "encoding-reopen", { actionId });
      setEncodingIssue(null);
      if (outcome.kind === "focused-dirty") {
        return { kind: "refused-dirty", documentId: outcome.document.id };
      }
      return { kind: "opened", document: applyOpened(outcome) };
    },
    [applyOpened],
  );

  const createDocument = useCallback(async () => {
    let document = createEmptyDocument();
    try {
      document = await fileService.createDocument();
    } catch {
      // Fall back to local document creation when IPC is unavailable.
    }
    // WI-3.5.5 wholesale: `upsertDocument` overwrites in place on an id collision.
    useTOCStore.getState().resetCoordination(document.id);
    useDocumentStore.getState().upsertDocument(document);
    useDocumentStore.getState().setActiveDocumentId(document.id);
    setEditorActiveDocumentId(document.id);
    return document;
  }, [setEditorActiveDocumentId]);

  const upsertAndActivateDocument = useCallback(
    (document: Document) => {
      // WI-3.5.5 wholesale: draft recovery / dev open, under the original path's id.
      prepareWholesaleReplace(document.id, "draft-recovery");
      useDocumentStore.getState().upsertDocument(document);
      useDocumentStore.getState().setActiveDocumentId(document.id);
      setEditorActiveDocumentId(document.id);
    },
    [setEditorActiveDocumentId],
  );

  const replaceDocument = useCallback((document: Document) => {
    // WI-3.5.5 wholesale: the file-reload leg, incl. the external file watcher.
    prepareWholesaleReplace(document.id, "file-reload"); // + WYSIWYG rebuild (D15-WI-5)
    useDocumentStore.getState().upsertDocument(document);
  }, []);

  const updateActiveDocumentContent = useCallback(
    (content: string) => {
      if (!activeDocument) return;
      useDocumentStore.getState().updateDocumentContent(activeDocument.id, content);
    },
    [activeDocument],
  );

  // D15: both save paths flush pending WYSIWYG edits and then read the document from
  // the store, never the render-time `activeDocument`. A failed flush throws (caught by
  // performSave as "Save failed: …"), so no save IPC runs and the doc stays dirty.
  // D19: after the await, neither path writes its pre-await snapshot back. On success
  // `applySaveResult` re-reads the store: an edit made during the save stays dirty and
  // keeps its draft, and a document closed during the save is not resurrected.
  const saveActiveDocumentAs = useCallback(async (actionId?: string) => {
    const doc = flushActiveDocumentForSave(actionId);
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
  }, []);

  const saveActiveDocument = useCallback(async (actionId?: string) => {
    const doc = flushActiveDocumentForSave(actionId);
    if (!doc) return null;
    if (!doc.path) {
      return saveActiveDocumentAs(actionId);
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
  }, [saveActiveDocumentAs]);

  const closeActiveDocument = useCallback(
    async (discardChanges: boolean) => {
      if (!activeDocument) return null;
      await fileService.closeDocument(activeDocument.id, discardChanges, activeDocument.path);
      // WI-3.5.5 eviction: close→reopen returns the same path-derived id.
      useTOCStore.getState().resetCoordination(activeDocument.id);
      useDocumentStore.getState().closeDocument(activeDocument.id);
      setEditorActiveDocumentId(null);
      return;
    },
    [activeDocument, setEditorActiveDocumentId],
  );

  const closeDocumentById = useCallback(
    async (id: string, discardChanges: boolean) => {
      const doc = useDocumentStore.getState().documents.find((d) => d.id === id);
      await fileService.closeDocument(id, discardChanges, doc?.path);
      // WI-3.5.5 eviction: the tab-bar X, which never reaches closeActiveDocument.
      useTOCStore.getState().resetCoordination(id);
      useDocumentStore.getState().closeDocument(id);
      if (useDocumentStore.getState().activeDocumentId === id) {
        setEditorActiveDocumentId(null);
      }
      return;
    },
    [setEditorActiveDocumentId],
  );

  return {
    documents,
    activeDocument,
    activeDocumentTitle: activeDocument
      ? getTitleFromPath(activeDocument.path)
      : "mdpro",
    openDocumentFromPath,
    openDocumentFromDialog,
    openDocumentWithEncoding,
    createDocument,
    upsertAndActivateDocument,
    replaceDocument,
    updateActiveDocumentContent,
    saveActiveDocument,
    saveActiveDocumentAs,
    closeActiveDocument,
    setActiveDocumentById,
    closeDocumentById,
    largeFileWarning,
    clearLargeFileWarning: () => setLargeFileWarning(null),
    encodingIssue,
    clearEncodingIssue: () => setEncodingIssue(null),
  };
}
