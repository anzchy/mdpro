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
}

export const useDocumentStore = create<DocumentStore>((set) => ({
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
    set((state) => ({
      documents: state.documents.filter((doc) => {
        if (doc.id === id) {
          const actionId = loggingService.generateActionId();
          loggingService.logEventSync({
            level: "info",
            event: "tab.close",
            status: "success",
            actionId,
            context: {
              documentId: doc.id,
              filePath: doc.path,
              wasModified: doc.isModified,
            },
          });
          loggingService.logEventSync({
            level: "info",
            event: "file.close",
            status: "success",
            actionId,
            context: {
              documentId: doc.id,
              filePath: doc.path,
            },
          });
          return false;
        }
        return true;
      }),
      activeDocumentId:
        state.activeDocumentId === id ? null : state.activeDocumentId,
    })),
}));
