/**
 * @module hooks/useReloadPrompt
 * Purpose: own the "External change detected" prompt's state for App.tsx — its
 * message and the id of the document it was raised for — and withdraw it when that
 * document closes by any path (D165).
 *
 * Pipeline: App's file-change decision → `raiseReload(message, documentId)` →
 *   ReloadDialog open · Reload / Ignore → `dismissReload()` · the owner leaves
 *   `documentStore.documents` → prompt cleared, `onWithdrawn()` (App passes the
 *   watcher's `clearEvent`), `ui.dialog.cancel` `controlId: "dialog.reload.withdraw"`.
 *
 * Key decisions:
 * - **Bound to a document id, not to whatever is active.** On device ⌘W closed the
 *   tab behind the prompt and left it on screen with no document (F3). The menu and
 *   shortcut guard (`modalTabActionGuard`) stops that path; this is the defence for
 *   a close that never meets it (programmatic, MCP-driven, window-level).
 * - **Withdraw clears the watcher event too**, so App's decision effect cannot raise
 *   the same stale event again for another document.
 * - `onWithdrawn` is read through a ref: App's `clearEvent` is a new function every
 *   render, and keying the effect on it would re-run it each render.
 * - The log carries the document id and a fixed reason only, never the path.
 *
 * @coordinates-with src/App.tsx — raises and dismisses; passes `clearEvent`
 * @coordinates-with src/components/common/ReloadDialog.tsx — the prompt it drives
 * @coordinates-with tests/d165-reload-prompt-orphan.test.tsx
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";

interface ReloadPromptState {
  message: string;
  documentId: string;
}

export interface ReloadPrompt {
  /** The prompt text while it is up; null while closed. */
  reloadMessage: string | null;
  /** Show (or replace) the prompt for `documentId`. */
  raiseReload: (message: string, documentId: string) => void;
  /** Close the prompt (its Reload or Ignore finished). */
  dismissReload: () => void;
}

const WITHDRAW_CONTROL_ID = "dialog.reload.withdraw";
const WITHDRAW_REASON = "document-closed";

export function useReloadPrompt(onWithdrawn: () => void): ReloadPrompt {
  const [prompt, setPrompt] = useState<ReloadPromptState | null>(null);
  const onWithdrawnRef = useRef(onWithdrawn);
  useLayoutEffect(() => {
    onWithdrawnRef.current = onWithdrawn;
  });

  const ownerId = prompt?.documentId ?? null;
  const ownerOpen = useDocumentStore((state) =>
    ownerId === null ? true : state.documents.some((doc) => doc.id === ownerId),
  );

  useEffect(() => {
    if (ownerId === null || ownerOpen) return;
    setPrompt(null);
    loggingService.logDialogAction(WITHDRAW_CONTROL_ID, "cancel", {
      reason: WITHDRAW_REASON,
      documentId: ownerId,
    });
    onWithdrawnRef.current();
  }, [ownerId, ownerOpen]);

  const raiseReload = useCallback((message: string, documentId: string) => {
    setPrompt({ message, documentId });
  }, []);
  const dismissReload = useCallback(() => setPrompt(null), []);

  return { reloadMessage: prompt?.message ?? null, raiseReload, dismissReload };
}
