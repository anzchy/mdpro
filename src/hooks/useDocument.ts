import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fileService } from "../services/fileService";
import type { Document } from "../types/document";
import { useDocumentStore } from "../stores/documentStore";
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
  const {
    documents,
    activeDocumentId,
    setActiveDocumentId,
    upsertDocument,
    updateDocumentContent,
    markDocumentModified,
    closeDocument,
  } = useDocumentStore();
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
        upsertDocument(result.document);
        setActiveDocumentId(result.document.id);
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
    [
      setActiveDocumentId,
      setEditorActiveDocumentId,
      setEncodingIssue,
      setLargeFileWarning,
      upsertDocument,
    ],
  );

  const setActiveDocumentById = useCallback(
    (id: string) => {
      setActiveDocumentId(id);
      setEditorActiveDocumentId(id);
    },
    [setActiveDocumentId, setEditorActiveDocumentId],
  );

  const openDocumentFromDialog = useCallback(async (actionId?: string) => {
    try {
      const result = await fileService.openFileDialog(actionId);
      if (!result) {
        return null;
      }
      upsertDocument(result.document);
      setActiveDocumentId(result.document.id);
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
  }, [setActiveDocumentId, setEditorActiveDocumentId, upsertDocument]);

  const openDocumentWithEncoding = useCallback(
    async (path: string, encoding: string, actionId?: string) => {
      const result = await fileService.openFile(path, encoding, actionId);
      upsertDocument(result.document);
      setActiveDocumentId(result.document.id);
      setEditorActiveDocumentId(result.document.id);
      if (result.document.fileSize && result.document.fileSize > LARGE_FILE_BYTES) {
        setLargeFileWarning("Large file opened (>10MB). Performance may be affected.");
      }
      setEncodingIssue(null);
      return result.document;
    },
    [
      setActiveDocumentId,
      setEditorActiveDocumentId,
      setEncodingIssue,
      setLargeFileWarning,
      upsertDocument,
    ],
  );

  const createDocument = useCallback(async () => {
    let document = createEmptyDocument();
    try {
      document = await fileService.createDocument();
    } catch {
      // Fall back to local document creation when IPC is unavailable.
    }
    upsertDocument(document);
    setActiveDocumentId(document.id);
    setEditorActiveDocumentId(document.id);
    return document;
  }, [
    setActiveDocumentId,
    setEditorActiveDocumentId,
    setEncodingIssue,
    setLargeFileWarning,
    upsertDocument,
  ]);

  const upsertAndActivateDocument = useCallback(
    (document: Document) => {
      upsertDocument(document);
      setActiveDocumentId(document.id);
      setEditorActiveDocumentId(document.id);
    },
    [setActiveDocumentId, setEditorActiveDocumentId, upsertDocument],
  );

  const replaceDocument = useCallback(
    (document: Document) => {
      upsertDocument(document);
    },
    [upsertDocument],
  );

  const updateActiveDocumentContent = useCallback(
    (content: string) => {
      if (!activeDocument) return;
      updateDocumentContent(activeDocument.id, content);
    },
    [activeDocument, updateDocumentContent],
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
      upsertDocument({
        ...activeDocument,
        path: result.path,
        isModified: false,
        lastSaved: result.savedAt,
      });
      markDocumentModified(activeDocument.id, false);
      void invoke("delete_draft", { documentId: activeDocument.id }).catch(() => {});
    }
    return result;
  }, [activeDocument, markDocumentModified, upsertDocument]);

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
      upsertDocument({
        ...activeDocument,
        path: result.path,
        isModified: false,
        lastSaved: result.savedAt,
      });
      markDocumentModified(activeDocument.id, false);
      void invoke("delete_draft", { documentId: activeDocument.id }).catch(() => {});
    }
    return result;
  }, [activeDocument, markDocumentModified, saveActiveDocumentAs, upsertDocument]);

  const closeActiveDocument = useCallback(
    async (discardChanges: boolean) => {
      if (!activeDocument) return null;
      await fileService.closeDocument(activeDocument.id, discardChanges, activeDocument.path);
      closeDocument(activeDocument.id);
      setEditorActiveDocumentId(null);
      return;
    },
    [activeDocument, closeDocument, setEditorActiveDocumentId],
  );

  const closeDocumentById = useCallback(
    async (id: string, discardChanges: boolean) => {
      const doc = useDocumentStore.getState().documents.find((d) => d.id === id);
      await fileService.closeDocument(id, discardChanges, doc?.path);
      closeDocument(id);
      if (activeDocumentId === id) {
        setEditorActiveDocumentId(null);
      }
      return;
    },
    [activeDocumentId, closeDocument, setEditorActiveDocumentId],
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
