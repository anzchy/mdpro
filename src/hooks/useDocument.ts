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
    async (path: string) => {
      try {
        const result = await fileService.openFile(path);
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
    [setActiveDocumentId, setEditorActiveDocumentId, upsertDocument],
  );

  const setActiveDocumentById = useCallback(
    (id: string) => {
      setActiveDocumentId(id);
      setEditorActiveDocumentId(id);
    },
    [setActiveDocumentId, setEditorActiveDocumentId],
  );

  const openDocumentFromDialog = useCallback(async () => {
    try {
      const result = await fileService.openFileDialog();
      if (!result) return null;
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
      }
      return null;
    }
  }, [setActiveDocumentId, setEditorActiveDocumentId, upsertDocument]);

  const openDocumentWithEncoding = useCallback(
    async (path: string, encoding: string) => {
      const result = await fileService.openFile(path, encoding);
      upsertDocument(result.document);
      setActiveDocumentId(result.document.id);
      setEditorActiveDocumentId(result.document.id);
      setEncodingIssue(null);
      return result.document;
    },
    [setActiveDocumentId, setEditorActiveDocumentId, upsertDocument],
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
  }, [setActiveDocumentId, setEditorActiveDocumentId, upsertDocument]);

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

  const saveActiveDocumentAs = useCallback(async () => {
    if (!activeDocument) return null;
    const suggestedName = getTitleFromPath(activeDocument.path);
    const result = await fileService.saveFileDialog(
      activeDocument.id,
      activeDocument.content,
      suggestedName,
    );
    if (result?.success) {
      upsertDocument({
        ...activeDocument,
        path: result.path,
        isModified: false,
        lastSaved: result.savedAt,
      });
      markDocumentModified(activeDocument.id, false);
      void invoke("delete_draft", { documentId: activeDocument.id });
    }
    return result;
  }, [activeDocument, markDocumentModified, upsertDocument]);

  const saveActiveDocument = useCallback(async () => {
    if (!activeDocument) return null;
    if (!activeDocument.path) {
      return saveActiveDocumentAs();
    }
    const result = await fileService.saveFile(
      activeDocument.id,
      activeDocument.content,
      activeDocument.path,
    );
    if (result?.success) {
      upsertDocument({
        ...activeDocument,
        path: result.path,
        isModified: false,
        lastSaved: result.savedAt,
      });
      markDocumentModified(activeDocument.id, false);
      void invoke("delete_draft", { documentId: activeDocument.id });
    }
    return result;
  }, [activeDocument, markDocumentModified, saveActiveDocumentAs, upsertDocument]);

  const closeActiveDocument = useCallback(
    async (discardChanges: boolean) => {
      if (!activeDocument) return null;
      await fileService.closeDocument(activeDocument.id, discardChanges);
      closeDocument(activeDocument.id);
      setEditorActiveDocumentId(null);
      return true;
    },
    [activeDocument, closeDocument, setEditorActiveDocumentId],
  );

  const closeDocumentById = useCallback(
    async (id: string, discardChanges: boolean) => {
      await fileService.closeDocument(id, discardChanges);
      closeDocument(id);
      if (activeDocumentId === id) {
        setEditorActiveDocumentId(null);
      }
      return true;
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
