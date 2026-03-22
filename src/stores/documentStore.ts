import { create } from "zustand";
import type { Document } from "../types/document";
import { loggingService } from "../services/loggingService";

interface DocumentStore {
  documents: Document[];
  activeDocumentId: string | null;
  setDocuments: (documents: Document[]) => void;
  setActiveDocumentId: (id: string | null) => void;
  upsertDocument: (document: Document) => void;
  updateDocumentContent: (id: string, content: string) => void;
  markDocumentModified: (id: string, isModified: boolean) => void;
  updateDocumentPath: (id: string, path: string) => void;
  closeDocument: (id: string) => void;
  /** Get a document by its ID */
  getDocumentById: (id: string) => Document | undefined;
  /** Set the active document (switches focus) */
  setActiveDocument: (id: string) => void;
  /** Get the currently active document */
  getActiveDocument: () => Document | undefined;
  /** Check if a document with the given path is already open */
  getDocumentByPath: (path: string) => Document | undefined;
}

export const useDocumentStore = create<DocumentStore>((set, get) => ({
  documents: [],
  activeDocumentId: null,
  setDocuments: (documents) => set({ documents }),
  setActiveDocumentId: (id) =>
    set((state) => {
      if (id && id !== state.activeDocumentId) {
        loggingService.logEventSync({
          level: "info",
          event: "tab.switch",
          status: "success",
          actionId: loggingService.generateActionId(),
          context: {
            fromDocumentId: state.activeDocumentId,
            toDocumentId: id,
          },
        });
      }
      return { activeDocumentId: id };
    }),
  upsertDocument: (document) =>
    set((state) => {
      const index = state.documents.findIndex((item) => item.id === document.id);
      if (index === -1) {
        loggingService.logEventSync({
          level: "info",
          event: "tab.open",
          status: "success",
          actionId: loggingService.generateActionId(),
          context: {
            documentId: document.id,
            filePath: document.path,
            tabIndex: state.documents.length,
          },
        });
        return { documents: [...state.documents, document] };
      }
      const next = [...state.documents];
      next[index] = document;
      return { documents: next };
    }),
  updateDocumentContent: (id, content) =>
    set((state) => ({
      documents: state.documents.map((doc) =>
        doc.id === id ? { ...doc, content, isModified: true } : doc,
      ),
    })),
  markDocumentModified: (id, isModified) =>
    set((state) => ({
      documents: state.documents.map((doc) =>
        doc.id === id ? { ...doc, isModified } : doc,
      ),
    })),
  updateDocumentPath: (id, path) =>
    set((state) => ({
      documents: state.documents.map((doc) =>
        doc.id === id ? { ...doc, path } : doc,
      ),
    })),
  closeDocument: (id) =>
    set((state) => {
      const closingDoc = state.documents.find((doc) => doc.id === id);
      if (closingDoc) {
        const actionId = loggingService.generateActionId();
        loggingService.logEventSync({
          level: "info",
          event: "tab.close",
          status: "success",
          actionId,
          context: {
            documentId: closingDoc.id,
            filePath: closingDoc.path,
            wasModified: closingDoc.isModified,
          },
        });
        loggingService.logEventSync({
          level: "info",
          event: "file.close",
          status: "success",
          actionId,
          context: {
            documentId: closingDoc.id,
            filePath: closingDoc.path,
          },
        });
      }

      const remaining = state.documents.filter((doc) => doc.id !== id);

      let nextActiveId = state.activeDocumentId;
      if (state.activeDocumentId === id) {
        if (remaining.length === 0) {
          nextActiveId = null;
        } else {
          const closedIdx = state.documents.findIndex((doc) => doc.id === id);
          const nextIdx = Math.min(closedIdx, remaining.length - 1);
          nextActiveId = remaining[nextIdx].id;
        }
      }

      return { documents: remaining, activeDocumentId: nextActiveId };
    }),

  getDocumentById: (id) => {
    return get().documents.find((doc) => doc.id === id);
  },

  setActiveDocument: (id) => {
    const state = get();
    const doc = state.documents.find((d) => d.id === id);
    if (!doc) return;

    if (id !== state.activeDocumentId) {
      loggingService.logEventSync({
        level: "info",
        event: "document.activate",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: {
          fromDocumentId: state.activeDocumentId,
          toDocumentId: id,
          filePath: doc.path,
        },
      });
    }

    set({ activeDocumentId: id });
  },

  getActiveDocument: () => {
    const state = get();
    if (!state.activeDocumentId) return undefined;
    return state.documents.find((doc) => doc.id === state.activeDocumentId);
  },

  getDocumentByPath: (path) => {
    return get().documents.find((doc) => doc.path === path);
  },
}));
