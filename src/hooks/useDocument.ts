import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fileService } from "../services/fileService";
import { preferencesService } from "../services/preferencesService";
import { flushActiveDocumentForSave } from "../services/saveService";
import type { Document } from "../types/document";
import { useDocumentStore } from "../stores/documentStore";
import { useTOCStore } from "../stores/tocStore";
import { prepareWholesaleReplace } from "../utils/wholesaleReplace";
import { loggingService } from "../services/loggingService";
import { useEditorStore } from "../stores/editorStore";
import { formatAllTables } from "../utils/tableFormatter";
import { makeIsFenced } from "../utils/fenceRanges";

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

const LARGE_FILE_BYTES = 10 * 1024 * 1024;

const parseEncodingError = (error: unknown) => {
  if (!error || typeof error !== "object") return null;
  const maybe = error as { EncodingError?: { path: string; detected: string } };
  if (maybe.EncodingError) return maybe.EncodingError;
  const message = (error as { message?: string }).message;
  if (message && message.includes("EncodingError")) {
    return { path: "", detected: "unknown" };
  }
  return null;
};

const deleteDraftAfterSave = (documentId: string) => {
  void invoke("delete_draft", { documentId }).catch((err) => {
    loggingService.logEventSync({
      level: "warn",
      event: "draft.delete",
      status: "fail",
      context: { documentId, error: err instanceof Error ? err.message : String(err) },
    });
  });
};

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

  const openDocumentFromPath = useCallback(
    async (path: string, actionId?: string) => {
      try {
        const result = await fileService.openFile(path, undefined, actionId);
        // WI-3.5.5 wholesale: reopen-in-place under an unchanged path-derived id.
        prepareWholesaleReplace(result.document.id, "file-open");
        useDocumentStore.getState().upsertDocument(result.document);
        useDocumentStore.getState().setActiveDocumentId(result.document.id);
        setEditorActiveDocumentId(result.document.id);
        if (result.document.fileSize && result.document.fileSize > LARGE_FILE_BYTES) {
          setLargeFileWarning("Large file opened (>10MB). Performance may be affected.");
        }
        return result.document;
      } catch (error) {
        const encodingError = parseEncodingError(error);
        if (encodingError) {
          setEncodingIssue({
            path: encodingError.path || path,
            detected: encodingError.detected || "unknown",
          });
        }
        return null;
      }
    },
    [setEditorActiveDocumentId],
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
      // WI-3.5.5 wholesale: the dialog can land on an already-open file.
      prepareWholesaleReplace(result.document.id, "file-open");
      useDocumentStore.getState().upsertDocument(result.document);
      useDocumentStore.getState().setActiveDocumentId(result.document.id);
      setEditorActiveDocumentId(result.document.id);
      if (result.document.fileSize && result.document.fileSize > LARGE_FILE_BYTES) {
        setLargeFileWarning("Large file opened (>10MB). Performance may be affected.");
      }
      return result.document;
    } catch (error) {
      const encodingError = parseEncodingError(error);
      if (encodingError) {
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
  }, [setEditorActiveDocumentId]);

  const openDocumentWithEncoding = useCallback(
    async (path: string, encoding: string, actionId?: string) => {
      const result = await fileService.openFile(path, encoding, actionId);
      // WI-3.5.5 wholesale: same id, whole buffer re-decoded.
      prepareWholesaleReplace(result.document.id, "encoding-reopen");
      useDocumentStore.getState().upsertDocument(result.document);
      useDocumentStore.getState().setActiveDocumentId(result.document.id);
      setEditorActiveDocumentId(result.document.id);
      if (result.document.fileSize && result.document.fileSize > LARGE_FILE_BYTES) {
        setLargeFileWarning("Large file opened (>10MB). Performance may be affected.");
      }
      setEncodingIssue(null);
      return result.document;
    },
    [setEditorActiveDocumentId],
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
      const { upsertDocument, markDocumentModified } = useDocumentStore.getState();
      upsertDocument({
        ...doc,
        path: result.path,
        isModified: false,
        lastSaved: result.savedAt,
      });
      markDocumentModified(doc.id, false);
      deleteDraftAfterSave(doc.id);
    }
    return result;
  }, []);

  const saveActiveDocument = useCallback(async (actionId?: string) => {
    const doc = flushActiveDocumentForSave(actionId);
    if (!doc) return null;
    if (!doc.path) {
      return saveActiveDocumentAs(actionId);
    }
    // Phase 3 WI-3.2: optional auto-reformat-on-save. The toggle is
    // off by default — only opt-in users see formatted output. We
    // update both the disk file AND the in-memory document so the
    // editor reflects the formatted source on next interaction.
    //
    // Audit-fix H3 (2026-05-04): pass an isFenced predicate so
    // table-shaped lines inside ``` code blocks aren't rewritten as
    // tables on save. Without this, opt-in users with code samples
    // containing pipes would see their fenced blocks corrupted.
    let contentToSave = doc.content;
    try {
      const prefs = await preferencesService.getPreferences();
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
      const { upsertDocument, markDocumentModified } = useDocumentStore.getState();
      upsertDocument({
        ...doc,
        content: contentToSave,
        path: result.path,
        isModified: false,
        lastSaved: result.savedAt,
      });
      markDocumentModified(doc.id, false);
      deleteDraftAfterSave(doc.id);
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
