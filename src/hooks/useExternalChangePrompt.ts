/**
 * Purpose: App's external-change wiring in one hook (D171) — the window's
 * `file:changed` listener, the decision log, the reload decision for the change the
 * active document presents, and the prompt's Reload / Ignore handlers, each settling
 * only the change the prompt displays.
 *
 * Pipeline: useFileWatcher (records every open document's change at once, presents
 *   the active one's after 300 ms) → decideFileChange → rename-follow
 *   (`updateDocumentPath`, record acknowledged) | `raiseReload(message, id, path, seq)`
 *   · Reload → token captured → `reloadActiveFromDisk` → success: acknowledge ≤ seq ·
 *   failure: keep the record and the prompt · settle: `dismissReload(token)` · Ignore →
 *   acknowledge the displayed seq, `dismissReload(token)`.
 *
 * Key decisions:
 * - **The prompt's token, not the current event, is what Reload / Ignore settle.** A
 *   change N+1 that arrives while Reload of N is in flight stays pending and prompts;
 *   A's reload settling after A closed cannot clear B's record or close B's prompt
 *   (the D172 audit's interleaving).
 * - **A failed Reload keeps the change pending and the prompt up**, with a toast; the
 *   old blanket clear left the save path free to overwrite the change.
 * - **A no-target Reload** (the document closed or moved meanwhile) closes its own
 *   prompt and clears nothing; a moved document's record was retired by the move.
 * - A rename / delete that arrived while the document was in the background is
 *   applied / prompted when it becomes active (the same decision, presented later).
 * - Extracted from App.tsx so the wiring is tested as it runs
 *   (`tests/support/externalChangeHarness.tsx`).
 *
 * @module hooks/useExternalChangePrompt
 * @coordinates-with src/App.tsx — the one caller; passes AppDialogs the prompt and handlers
 * @coordinates-with src/hooks/useFileWatcher.ts — the presented change and `clearEvent`
 * @coordinates-with src/hooks/useReloadPrompt.ts — the prompt bound to a document and a seq
 * @coordinates-with src/stores/externalChangeStore.ts — `acknowledgeFileChange`
 * @coordinates-with src/utils/reloadTarget.ts — the Reload body
 */
import { useCallback, useEffect } from "react";
import { acknowledgeFileChange } from "../stores/externalChangeStore";
import { useDocumentStore } from "../stores/documentStore";
import type { Document } from "../types/document";
import { decideFileChange } from "../utils/dataLossGuards";
import { reloadActiveFromDisk } from "../utils/reloadTarget";
import { useFileChangeDecisionLog } from "./useFileChangeDecisionLog";
import { useFileWatcher } from "./useFileWatcher";
import { useReloadPrompt } from "./useReloadPrompt";

export interface ExternalChangePromptDeps {
  activeDocument: Document | null;
  replaceDocument: (document: Document) => void;
  showToast: (message: string) => void;
  setBusyLabel: (label: string | null) => void;
}

export interface ExternalChangePrompt {
  reloadMessage: string | null;
  handleReloadFile: () => Promise<void>;
  handleIgnoreReload: () => void;
}

export function useExternalChangePrompt(deps: ExternalChangePromptDeps): ExternalChangePrompt {
  const { activeDocument, replaceDocument, showToast, setBusyLabel } = deps;
  const updateDocumentPath = useDocumentStore((state) => state.updateDocumentPath);
  const { event: fileChangeEvent, change, clearEvent } = useFileWatcher(activeDocument?.path ?? null);
  useFileChangeDecisionLog(fileChangeEvent, activeDocument);
  const { reloadMessage, promptToken, raiseReload, dismissReload } = useReloadPrompt(clearEvent);

  useEffect(() => {
    if (!activeDocument || !fileChangeEvent || !change) return;
    const decision = decideFileChange(fileChangeEvent, activeDocument);
    switch (decision.action) {
      case "ignore":
        return;
      case "rename":
        updateDocumentPath(activeDocument.id, decision.newPath);
        acknowledgeFileChange(change.documentId, change.seq, "renamed");
        return;
      case "deleted-prompt":
        // Surface a prompt; do NOT reload (would clobber in-editor edits).
        raiseReload(decision.message, activeDocument.id, fileChangeEvent.path, change.seq);
        return;
      case "reload-prompt":
        // Surface a prompt; reload is user-initiated via handleReloadFile.
        raiseReload(decision.message, activeDocument.id, fileChangeEvent.path, change.seq);
        return;
    }
  }, [activeDocument, change, fileChangeEvent, raiseReload, updateDocumentPath]);

  const handleReloadFile = useCallback(async () => {
    const token = promptToken;
    if (!token) return;
    setBusyLabel("Reloading...");
    let failed = false;
    try {
      // D138: in place under the prompted tab's id; no target (closed/switched) → no toast.
      const outcome = await reloadActiveFromDisk(token.path, replaceDocument);
      if (outcome.kind === "reloaded") {
        if (outcome.documentId === token.documentId) {
          acknowledgeFileChange(token.documentId, token.seq, "reloaded");
        }
        showToast("File reloaded");
      }
    } catch {
      failed = true; // D171: keep the change pending and the prompt up
      showToast("Reload failed");
    } finally {
      setBusyLabel(null);
      if (!failed) dismissReload(token);
    }
  }, [dismissReload, promptToken, replaceDocument, setBusyLabel, showToast]);

  const handleIgnoreReload = useCallback(() => {
    const token = promptToken;
    if (!token) return;
    acknowledgeFileChange(token.documentId, token.seq, "ignored");
    dismissReload(token);
  }, [dismissReload, promptToken]);

  return { reloadMessage, handleReloadFile, handleIgnoreReload };
}
