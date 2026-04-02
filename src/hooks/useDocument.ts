import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fileService } from "../services/fileService";
import type { Document } from "../types/document";
import { useDocumentStore } from "../stores/documentStore";
import { loggingService } from "../services/loggingService";
import { useEditorStore } from "../stores/editorStore";

const createEmptyDocument = (): Document => ({
  id:
    globalThis.crypto?.randomUUID?.() ??
    `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  path: null,
  content: "",
  encoding: "UTF-8",
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
    useDocumentStore.getState().upsertDocument(document);
    useDocumentStore.getState().setActiveDocumentId(document.id);
    setEditorActiveDocumentId(document.id);
    return document;
  }, [setEditorActiveDocumentId]);

  const upsertAndActivateDocument = useCallback(
    (document: Document) => {
      useDocumentStore.getState().upsertDocument(document);
      useDocumentStore.getState().setActiveDocumentId(document.id);
      setEditorActiveDocumentId(document.id);
    },
    [setEditorActiveDocumentId],
  );

  const replaceDocument = useCallback(
    (document: Document) => {
      useDocumentStore.getState().upsertDocument(document);
    },
    [],
  );

  const updateActiveDocumentContent = useCallback(
    (content: string) => {
      if (!activeDocument) return;
      useDocumentStore.getState().updateDocumentContent(activeDocument.id, content);
    },
    [activeDocument],
  );

  const saveActiveDocumentAs = useCallback(async (actionId?: string) => {
    if (!activeDocument) return null;
    const suggestedName = getTitleFromPath(activeDocument.path);
    const result = await fileService.saveFileDialog(
      activeDocument.id,
      activeDocument.content,
      suggestedName,
      actionId,
    );
    if (result?.success) {
      const { upsertDocument, markDocumentModified } = useDocumentStore.getState();
      upsertDocument({
        ...activeDocument,
        path: result.path,
        isModified: false,
        lastSaved: result.savedAt,
      });
      markDocumentModified(activeDocument.id, false);
      void invoke("delete_draft", { documentId: activeDocument.id }).catch((err) => {
        loggingService.logEventSync({
          level: 'warn',
          event: 'draft.delete',
          status: 'fail',
          context: { documentId: activeDocument.id, error: err instanceof Error ? err.message : String(err) },
        });
      });
    }
    return result;
  }, [activeDocument]);

  const saveActiveDocument = useCallback(async (actionId?: string) => {
    if (!activeDocument) return null;
    if (!activeDocument.path) {
      return saveActiveDocumentAs(actionId);
    }
    const result = await fileService.saveFile(
      activeDocument.id,
      activeDocument.content,
      activeDocument.path,
      actionId,
    );
    if (result?.success) {
      const { upsertDocument, markDocumentModified } = useDocumentStore.getState();
      upsertDocument({
        ...activeDocument,
        path: result.path,
        isModified: false,
        lastSaved: result.savedAt,
      });
      markDocumentModified(activeDocument.id, false);
      void invoke("delete_draft", { documentId: activeDocument.id }).catch((err) => {
        loggingService.logEventSync({
          level: 'warn',
          event: 'draft.delete',
          status: 'fail',
          context: { documentId: activeDocument.id, error: err instanceof Error ? err.message : String(err) },
        });
      });
    }
    return result;
  }, [activeDocument, saveActiveDocumentAs]);

  const closeActiveDocument = useCallback(
    async (discardChanges: boolean) => {
      if (!activeDocument) return null;
      await fileService.closeDocument(activeDocument.id, discardChanges, activeDocument.path);
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
