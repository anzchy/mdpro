import { create } from "zustand";
import type { Document } from "../types/document";
import { loggingService } from "../services/loggingService";
import { useMilkdownEditorStore } from "./milkdownEditorStore";
import { activeFlushFailed, refuseTabSwitch } from "../utils/flushRefusal";

/**
 * D15: a tab transition pushes the outgoing editor's pending WYSIWYG edits into this
 * store first. Always called before `set`, never inside an updater, so the transition
 * computes from post-flush state and cannot overwrite the flush's write. The editor's
 * destroy flush remains the backstop for raw `setState` callers.
 *
 * D92 / D95: a switch flushes through `activeFlushFailed`, which runs every flusher and
 * refuses only when the outgoing (active) document's own flush failed (its editor
 * would unmount and its edits be lost). A close runs this aggregate flush and ignores
 * the result, because a close is a deliberate discard the close prompt
 * (`dataLossGuards.ts`) already guarded.
 */
function flushBeforeClose(): void {
  useMilkdownEditorStore.getState().flushPendingEdits("tab-close");
}

interface DocumentStore {
  documents: Document[];
  activeDocumentId: string | null;
  setDocuments: (documents: Document[]) => void;
  /**
   * Switch the active document. D92: returns `false` and changes nothing when the
   * outgoing (active) document's own flush failed (logged as `tab.switch`, toasted);
   * another document's failing flush does not refuse (D95); `true` when it switched or `id`
   * is already active. A caller that pairs this with `editorStore.setActiveDocumentId`
   * must only do so on `true`, so the two stores never disagree.
   */
  setActiveDocumentId: (id: string | null) => boolean;
  upsertDocument: (document: Document) => void;
  updateDocumentContent: (id: string, content: string) => void;
  markDocumentModified: (id: string, isModified: boolean) => void;
  updateDocumentPath: (id: string, path: string) => void;
  /** Apply every move in one `set`, so subscribers see only the final paths (b87). */
  updateDocumentPaths: (moves: ReadonlyArray<{ id: string; path: string }>) => void;
  closeDocument: (id: string) => void;
  /** Get a document by its ID */
  getDocumentById: (id: string) => Document | undefined;
  /** Set the active document (switches focus). Same D92 refusal and result as
   *  `setActiveDocumentId`, logged as `document.activate`; `false` also when `id` is
   *  not open. */
  setActiveDocument: (id: string) => boolean;
  /** Get the currently active document */
  getActiveDocument: () => Document | undefined;
  /** Check if a document with the given path is already open */
  getDocumentByPath: (path: string) => Document | undefined;
}

export const useDocumentStore = create<DocumentStore>((set, get) => ({
  documents: [],
  activeDocumentId: null,
  setDocuments: (documents) => set({ documents }),
  setActiveDocumentId: (id) => {
    const from = get().activeDocumentId;
    if (id === from) return true;
    if (activeFlushFailed(from, "tab-switch")) {
      refuseTabSwitch(from, id, "setActiveDocumentId");
      return false;
    }
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
    });
    return true;
  },
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
  updateDocumentPaths: (moves) => {
    if (moves.length === 0) return;
    const to = new Map(moves.map(({ id, path }) => [id, path]));
    set((state) => ({
      documents: state.documents.map((doc) => {
        const path = to.get(doc.id);
        return path === undefined ? doc : { ...doc, path };
      }),
    }));
  },
  closeDocument: (id) => {
    // Outside the updater: `remaining` below must be computed from post-flush state.
    // D92: a close is never refused, so no result is read.
    flushBeforeClose();
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
    });
  },

  getDocumentById: (id) => {
    return get().documents.find((doc) => doc.id === id);
  },

  setActiveDocument: (id) => {
    const state = get();
    const doc = state.documents.find((d) => d.id === id);
    if (!doc) return false;

    if (id !== state.activeDocumentId) {
      if (activeFlushFailed(state.activeDocumentId, "tab-switch")) {
        refuseTabSwitch(state.activeDocumentId, id, "setActiveDocument");
        return false;
      }
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
    return true;
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
