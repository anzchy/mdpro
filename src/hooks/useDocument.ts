import { useCallback, useMemo } from "react";
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

  const activeDocument = useMemo(
    () => documents.find((doc) => doc.id === activeDocumentId) ?? null,
    [documents, activeDocumentId],
  );

  const openDocumentFromPath = useCallback(
    async (path: string) => {
      const result = await fileService.openFile(path);
      upsertDocument(result.document);
      setActiveDocumentId(result.document.id);
      setEditorActiveDocumentId(result.document.id);
      return result.document;
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
    const result = await fileService.openFileDialog();
    if (!result) return null;
    upsertDocument(result.document);
    setActiveDocumentId(result.document.id);
    setEditorActiveDocumentId(result.document.id);
    return result.document;
  }, [setActiveDocumentId, setEditorActiveDocumentId, upsertDocument]);

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
    createDocument,
    updateActiveDocumentContent,
    saveActiveDocument,
    saveActiveDocumentAs,
    closeActiveDocument,
    setActiveDocumentById,
    closeDocumentById,
  };
}
