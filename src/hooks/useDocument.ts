import { useCallback, useMemo, useState } from "react";
import { fileService, type OpenFileResult } from "../services/fileService";
import * as documentSave from "../services/documentSave";
import type { Document } from "../types/document";
import { useDocumentStore } from "../stores/documentStore";
import { useTOCStore } from "../stores/tocStore";
import { prepareWholesaleReplace } from "../utils/wholesaleReplace";
import { useEditorStore } from "../stores/editorStore";
import {
  commitOpenedDocument,
  encodingRetryCancelled,
  focusDirtyOpenAt,
  type EncodingReopenResult,
  type OpenWriteResult,
} from "../utils/openWriteGuard";
import { parseEncodingError, reportOpenFailure } from "../utils/openFailure";
import { beginCapture } from "../utils/fileChangeCapture";

export { supersedeRetry } from "../utils/openWriteGuard";

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

/** What an open by path did (D95): the document, and whether it became active. */
export interface OpenPathOutcome {
  document: Document;
  /** False exactly when the D92 guard withheld activation (a failed WYSIWYG flush). */
  activated: boolean;
}

/** Pair `document` with whether the open left it active, read right after the guard. */
const withActivation = (document: Document): OpenPathOutcome => ({
  document,
  activated: useDocumentStore.getState().activeDocumentId === document.id,
});

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
  // D95: resolves to `{ document, activated }`, so a caller's follow-up (the default
  // view mode) can skip an open whose activation the D92 guard refused. D126: the one
  // by-path open; the `openDocumentFromPath` wrapper (document only) was removed.
  // D111: each open settles its in-flight events and flag on the committed doc (fileChangeCapture).
  const openPathOutcome = useCallback(
    async (path: string, actionId?: string): Promise<OpenPathOutcome | null> => {
      const capture = beginCapture(path);
      try {
        const result = await fileService.openFile(path, undefined, actionId);
        const opened = commitOpenedDocument(result.document, "file-open", { actionId });
        return withActivation(applyOpened(capture.settleOpen(opened, result.changedSinceRead, actionId)));
      } catch (error) {
        capture.settle(null);
        const encodingError = parseEncodingError(error);
        if (encodingError) {
          const focused = focusDirtyOpenAt(encodingError.path || path, { actionId });
          if (focused) return withActivation(focused);
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

  // D92: documentStore refuses a switch whose WYSIWYG flush failed. editorStore follows
  // only a switch that happened, so the two stores never name different documents.
  const activateInBothStores = useCallback(
    (id: string): boolean => {
      const switched = useDocumentStore.getState().setActiveDocumentId(id);
      if (switched) setEditorActiveDocumentId(id);
      return switched;
    },
    [setEditorActiveDocumentId],
  );

  const setActiveDocumentById = useCallback(
    (id: string) => {
      activateInBothStores(id);
    },
    [activateInBothStores],
  );

  const openDocumentFromDialog = useCallback(async (actionId?: string) => {
    const capture = beginCapture(null); // the dialog picks the path in Rust
    try {
      const result = await fileService.openFileDialog(actionId);
      if (!result) {
        return null;
      }
      const opened = commitOpenedDocument(result.document, "file-open", { actionId });
      return applyOpened(capture.settleOpen(opened, result.changedSinceRead, actionId));
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
    } finally {
      capture.settle(null);
    }
  }, [applyOpened]);

  /**
   * Re-decode under `encoding`; a dirty target is refused (kept and focused), not replaced.
   * D121: when `signal` is aborted by the time the read settles (the dialog was cancelled,
   * or a newer retry superseded this one), nothing is committed, the encoding issue is
   * left alone, a late rejection is swallowed, and the result is `cancelled`. Without a
   * signal the behaviour is unchanged.
   */
  const openDocumentWithEncoding = useCallback(
    async (
      path: string,
      encoding: string,
      actionId?: string,
      signal?: AbortSignal,
    ): Promise<EncodingReopenResult> => {
      let result: OpenFileResult;
      const capture = beginCapture(path);
      try {
        try {
          result = await fileService.openFile(path, encoding, actionId);
        } catch (error) {
          if (signal?.aborted) return encodingRetryCancelled(actionId);
          throw error;
        }
        if (signal?.aborted) return encodingRetryCancelled(actionId);
        const committed = commitOpenedDocument(result.document, "encoding-reopen", { actionId });
        const outcome = capture.settleOpen(committed, result.changedSinceRead, actionId);
        setEncodingIssue(null);
        if (outcome.kind === "focused-dirty") {
          return { kind: "refused-dirty", documentId: outcome.document.id };
        }
        return { kind: "opened", document: applyOpened(outcome) };
      } finally {
        capture.settle(null);
      }
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
    // D92: a refused switch leaves the new tab open but inactive.
    activateInBothStores(document.id);
    return document;
  }, [activateInBothStores]);

  const upsertAndActivateDocument = useCallback(
    (document: Document) => {
      // WI-3.5.5 wholesale: draft recovery / dev open, under the original path's id.
      prepareWholesaleReplace(document.id, "draft-recovery");
      useDocumentStore.getState().upsertDocument(document);
      activateInBothStores(document.id); // D92: refused → upserted, not active
    },
    [activateInBothStores],
  );

  const replaceDocument = useCallback((document: Document) => {
    // WI-3.5.5 wholesale: the file-reload leg, incl. the external file watcher. D138: the
    // caller (`utils/reloadTarget.ts`) passes the prompted tab's id, not reload_file's.
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

  // D70: each save runs in its document's queue, so ⌘S → type → ⌘S cannot let the
  // older save land last. The bodies (D15 flush, D19 apply) live in documentSave.ts.
  const saveActiveDocumentAs = useCallback(
    (actionId?: string) => documentSave.saveActiveDocumentAs(actionId),
    [],
  );
  const saveActiveDocument = useCallback(
    (actionId?: string) => documentSave.saveActiveDocument(actionId),
    [],
  );

  const closeActiveDocument = useCallback(
    async (discardChanges: boolean) => {
      if (!activeDocument) return null;
      await fileService.closeDocument(activeDocument.id, discardChanges, activeDocument.path);
      // WI-3.5.5 eviction: close→reopen returns the same path-derived id.
      useTOCStore.getState().resetCoordination(activeDocument.id);
      useDocumentStore.getState().closeDocument(activeDocument.id);
      // D96: follow the neighbour documentStore moved to, so the two stores agree.
      setEditorActiveDocumentId(useDocumentStore.getState().activeDocumentId);
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
      // D96: closeDocument has already moved the active id off `id`, so re-read it
      // rather than compare against `id`, which was never true here.
      setEditorActiveDocumentId(useDocumentStore.getState().activeDocumentId);
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
    openPathOutcome,
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
