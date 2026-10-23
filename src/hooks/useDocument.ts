import { useCallback, useEffect, useMemo, useState } from "react";
import { fileService, type OpenFileResult } from "../services/fileService";
import * as documentSave from "../services/documentSave";
import type { Document } from "../types/document";
import { useDocumentStore } from "../stores/documentStore";
import { useTOCStore } from "../stores/tocStore";
import { prepareWholesaleReplace } from "../utils/wholesaleReplace";
import { useEditorStore } from "../stores/editorStore";
import { useTabStore } from "../stores/tabStore";
import { switchToMostRecentDocument } from "./switchDocuments";
import {
  commitOpenedDocument,
  encodingRetryCancelled,
  focusDirtyOpenAt,
  type EncodingReopenResult,
  type OpenWriteResult,
} from "../utils/openWriteGuard";
import { parseEncodingError, reportOpenFailure } from "../utils/openFailure";
import { beginCapture } from "../utils/fileChangeCapture";
import { commitDocumentClose } from "./documentCloseCommit";

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

  useEffect(() => {
    useTabStore.getState().syncDocuments(documents, activeDocumentId);
  }, [documents, activeDocumentId]);

  /** Set the large-file warning for a written open, and hand back the document. */
  const applyOpened = useCallback((outcome: OpenWriteResult): Document => {
    if (outcome.kind === "written" && outcome.largeFile) setLargeFileWarning(LARGE_FILE_WARNING);
    return outcome.document;
  }, []);

  // D20 / ADR-0028: every open writes through `commitOpenedDocument` AFTER the read's await;
  // a dirty target (after a "reopen" flush) is focused, never replaced, and returned so
  // callers record the path; `focusDirtyOpenAt` does the same before EncodingDialog. D46: any
  // other failure gets the ⌘O toast and a path-free log (`reportOpenFailure`), returns null.
  // D95: resolves to `{ document, activated }` so a follow-up can skip a refused activation.
  // D126: the one by-path open. D111: each open settles its in-flight events on the committed doc.
  // D214-WI-6: all three opens capture the store's baseline generation before the IPC and
  // pass it to the guard, so a tab whose file changed during the read is not marked clean.
  const openPathOutcome = useCallback(
    async (path: string, actionId?: string): Promise<OpenPathOutcome | null> => {
      const capture = beginCapture(path);
      const startGeneration = useDocumentStore.getState().baselineGeneration;
      try {
        const result = await fileService.openFile(path, undefined, actionId);
        const opened = commitOpenedDocument(result.document, "file-open", { actionId, startGeneration });
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
    const startGeneration = useDocumentStore.getState().baselineGeneration;
    try {
      const result = await fileService.openFileDialog(actionId);
      if (!result) {
        return null;
      }
      const opened = commitOpenedDocument(result.document, "file-open", { actionId, startGeneration });
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
      const startGeneration = useDocumentStore.getState().baselineGeneration;
      try {
        try {
          result = await fileService.openFile(path, encoding, actionId);
        } catch (error) {
          if (signal?.aborted) return encodingRetryCancelled(actionId);
          throw error;
        }
        if (signal?.aborted) return encodingRetryCancelled(actionId);
        const committed = commitOpenedDocument(result.document, "encoding-reopen", { actionId, startGeneration });
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
      // D261 H1: removes it only if this is still the lifetime the close began on.
      await commitDocumentClose(activeDocument.id, discardChanges, setEditorActiveDocumentId);
      return;
    },
    [activeDocument, setEditorActiveDocumentId],
  );

  const closeDocumentById = useCallback(
    async (id: string, discardChanges: boolean) => {
      // The tab-bar X, which never reaches closeActiveDocument; same commit and H1 guard.
      await commitDocumentClose(id, discardChanges, setEditorActiveDocumentId);
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
    switchToMostRecentDocument,
    closeDocumentById,
    largeFileWarning,
    clearLargeFileWarning: () => setLargeFileWarning(null),
    encodingIssue,
    clearEncodingIssue: () => setEncodingIssue(null),
  };
}
