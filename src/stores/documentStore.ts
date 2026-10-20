import { create } from "zustand";
import type { Document } from "../types/document";
import { loggingService } from "../services/loggingService";
import { useMilkdownEditorStore } from "./milkdownEditorStore";
import { activeFlushFailed, refuseTabSwitch } from "../utils/flushRefusal";
import { INITIAL_BASELINE_EPOCHS, movedSince, stampBaseline, stampLifetime, stampPathMoves, stampReplacement } from "./baselineEpoch";
import type { BaselineEpochs } from "./baselineEpoch";

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

/**
 * D214: a clean document's baseline is its content. A dirty one keeps `savedContent`
 * exactly as given (absent = no baseline, i.e. sticky dirty).
 */
function withBaseline(doc: Document): Document {
  return doc.isModified ? doc : { ...doc, savedContent: doc.content };
}

/** D214: dirty unless a baseline exists and `content` is exactly it. */
function differsFromBaseline(doc: Document, content: string): boolean {
  return doc.savedContent === undefined || content !== doc.savedContent;
}

/** D214-WI-8: the old → new path of every document `to` moves (by id). */
function pathMoves(documents: Document[], to: ReadonlyMap<string, string>) {
  return documents.filter((doc) => to.has(doc.id)).map((doc) => ({ from: doc.path, to: to.get(doc.id) ?? null }));
}

/** D214-WI-6: has `id`'s baseline been dropped (or the document closed) since `start`? */
export function baselineMovedSince(id: string, start: number | undefined): boolean {
  return movedSince(useDocumentStore.getState().baselineEpoch, id, start);
}

/** D214-WI-7: the same, for any document at `path` (a closed tab, a D145 UUID tab). */
export function baselinePathMovedSince(path: string | null, start: number | undefined): boolean {
  return movedSince(useDocumentStore.getState().baselinePathEpoch, path, start);
}

/** The D214 generation state (`baselineEpoch.ts`): `dropBaseline` and `closeDocument`
 *  stamp the document's id and path; a reply stamped after its capture is demoted. */
interface DocumentStore extends BaselineEpochs {
  documents: Document[];
  /** D214-WI-5: `baselineEpoch[id]`, 0 when absent. */
  getBaselineEpoch: (id: string) => number;
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
  /**
   * Insert or replace a document. D214: a clean upsert (`isModified: false`) is a clean
   * point: `savedContent = content`, overriding any value passed. A dirty upsert stores
   * `savedContent` exactly as passed (absent = no baseline) and never inherits the
   * baseline of the document it replaces. An in-place replacement starts a new
   * lifetime (D290); a path change stamps both paths (D214-WI-8).
   */
  upsertDocument: (document: Document) => void;
  /**
   * Write new content. D214: `isModified = savedContent === undefined || content !==
   * savedContent` (strict `===`), so writing the saved text back reads clean; a document
   * without a baseline stays dirty. The baseline itself never changes here.
   */
  updateDocumentContent: (id: string, content: string) => void;
  /**
   * `true` changes the flag only (an eager mark; the baseline is kept, so a later write
   * equal to it reads clean). `false` is a clean point: the current content becomes the
   * baseline (D214).
   */
  markDocumentModified: (id: string, isModified: boolean) => void;
  /**
   * D214-WI-4: the file changed on disk without a clean point (an external modify,
   * delete or create, another window's save, an open divergence), so the saved text is
   * no longer known. Sets `savedContent` to `undefined` on `id` only; `isModified` is
   * untouched (clean stays clean; dirty stays dirty, sticky until the next clean point).
   * Always stamps the id and path with a new generation (D214-WI-6/7), even without
   * a baseline.
   */
  dropBaseline: (id: string) => void;
  /** Change a document's path; its baseline is kept (D214); both paths are stamped (WI-8). */
  updateDocumentPath: (id: string, path: string) => void;
  /** Apply every move in one `set`, so subscribers see only the final paths (b87).
   *  Baselines are kept (D214); every old and new path is stamped, one generation (WI-8). */
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
  ...INITIAL_BASELINE_EPOCHS,
  getBaselineEpoch: (id) => get().baselineEpoch[id] ?? 0,
  activeDocumentId: null,
  // No caller in src/ (D214-WI-8 inventory). It replaces documents without the
  // baseline stamps closeDocument / dropBaseline / path moves write, so a new
  // caller must route removals and path changes through those instead.
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
  upsertDocument: (incoming) =>
    set((state) => {
      const document = withBaseline(incoming);
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
        return { documents: [...state.documents, document], ...stampLifetime(state, document.id) };
      }
      const next = [...state.documents];
      next[index] = document;
      const moved = stampPathMoves(state, [{ from: state.documents[index].path, to: document.path }]);
      return { documents: next, ...moved, ...stampReplacement(state, document.id) };
    }),
  updateDocumentContent: (id, content) =>
    set((state) => ({
      documents: state.documents.map((doc) =>
        doc.id === id ? { ...doc, content, isModified: differsFromBaseline(doc, content) } : doc,
      ),
    })),
  markDocumentModified: (id, isModified) =>
    set((state) => ({
      documents: state.documents.map((doc) =>
        doc.id !== id ? doc : isModified ? { ...doc, isModified } : withBaseline({ ...doc, isModified }),
      ),
    })),
  dropBaseline: (id) =>
    set((state) => ({
      ...stampBaseline(state, id, state.documents.find((doc) => doc.id === id)?.path ?? null),
      documents: state.documents.some((doc) => doc.id === id && doc.savedContent !== undefined)
        ? state.documents.map((doc) => (doc.id === id ? { ...doc, savedContent: undefined } : doc))
        : state.documents,
    })),
  updateDocumentPath: (id, path) =>
    set((state) => ({
      ...stampPathMoves(state, pathMoves(state.documents, new Map([[id, path]]))),
      documents: state.documents.map((doc) =>
        doc.id === id ? { ...doc, path } : doc,
      ),
    })),
  updateDocumentPaths: (moves) => {
    if (moves.length === 0) return;
    const to = new Map(moves.map(({ id, path }) => [id, path]));
    set((state) => ({
      ...stampPathMoves(state, pathMoves(state.documents, to)),
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

      // D214-WI-6/7: a close stamps id and path, so a reply for either is demoted.
      const stamp = closingDoc ? stampBaseline(state, id, closingDoc.path) : {};
      return { documents: remaining, activeDocumentId: nextActiveId, ...stamp, ...(closingDoc ? stampLifetime(state, id) : {}) };
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
