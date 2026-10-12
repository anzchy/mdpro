/**
 * @module hooks/useReloadPrompt
 * Purpose: own the "External change detected" prompt's state — its message, the id
 * of the document it was raised for, the path of the watcher event behind it and the
 * sequence of the recorded change it shows (D171) — and withdraw it when that
 * document closes by any path (D165).
 *
 * Pipeline: the file-change decision (`useExternalChangePrompt`) →
 *   `raiseReload(message, documentId, path, seq)` → ReloadDialog open · Reload / Ignore
 *   → `dismissReload(token)` · the owner leaves `documentStore.documents` → prompt
 *   cleared, `onWithdrawn(path, documentId)` (the watcher's `clearEvent`, which drops
 *   only that document's record), `ui.dialog.cancel` `controlId: "dialog.reload.withdraw"`.
 *
 * Key decisions:
 * - **Bound to a document id, not to whatever is active.** On device ⌘W closed the
 *   tab behind the prompt and left it on screen with no document (F3). The menu and
 *   shortcut guard (`modalTabActionGuard`) stops that path; this is the defence for
 *   a close that never meets it (programmatic, MCP-driven, window-level).
 * - **Withdraw clears the watcher event too, but only the owner's** (D172): it
 *   passes the path the prompt was raised for, and `clearEvent(path)` leaves an
 *   event for another path alone. Unconditionally, closing A in the same React
 *   commit as B's event dropped B's event, and B's Reload then did nothing.
 * - **A repeat raise with the same message, document and path keeps the same state
 *   object** (D172), so it costs no commit. App's decision effect re-runs whenever
 *   any of its deps change; a fresh object each time fed a render loop.
 * - `onWithdrawn` is read through a ref so the withdraw effect is keyed on the
 *   owner only; a caller may pass an inline function (App's `clearEvent` is stable).
 * - **`promptToken` is what Reload / Ignore settle (D171).** It names the document and
 *   the displayed sequence; `dismissReload(token)` closes the prompt only while it
 *   still shows that token, so A's reload settling after A closed and B's prompt
 *   came up leaves B's prompt alone. `dismissReload()` with no token closes whatever
 *   is shown (ReloadDialog's own Ignore wiring in tests).
 * - The log carries the document id and a fixed reason only, never the path.
 *
 * @coordinates-with src/hooks/useExternalChangePrompt.ts — raises and dismisses; passes `clearEvent`
 * @coordinates-with src/hooks/useFileWatcher.ts — `clearEvent(path, documentId)`, the owner-only clear
 * @coordinates-with src/components/common/ReloadDialog.tsx — the prompt it drives
 * @coordinates-with tests/d165-reload-prompt-orphan.test.tsx
 * @coordinates-with tests/d172-reload-prompt-render-loop.test.tsx
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";

/** Which recorded change a prompt shows: Reload / Ignore settle exactly this (D171). */
export interface ReloadPromptToken {
  documentId: string;
  /** The watcher event's path; handed back to `onWithdrawn` on withdrawal. */
  path: string;
  /** The recorded change's sequence; 0 when raised without one. */
  seq: number;
}

interface ReloadPromptState extends ReloadPromptToken {
  message: string;
}

export interface ReloadPrompt {
  /** The prompt text while it is up; null while closed. */
  reloadMessage: string | null;
  /** The change the prompt shows while it is up; null while closed. */
  promptToken: ReloadPromptToken | null;
  /** Show (or replace) the prompt for `documentId`, raised by change `seq` of `path`. */
  raiseReload: (message: string, documentId: string, path: string, seq?: number) => void;
  /** Close the prompt; given `token`, only while the prompt still shows it. */
  dismissReload: (token?: ReloadPromptToken) => void;
}

const WITHDRAW_CONTROL_ID = "dialog.reload.withdraw";
const WITHDRAW_REASON = "document-closed";

export function useReloadPrompt(onWithdrawn: (path: string, documentId: string) => void): ReloadPrompt {
  const [prompt, setPrompt] = useState<ReloadPromptState | null>(null);
  const onWithdrawnRef = useRef(onWithdrawn);
  useLayoutEffect(() => {
    onWithdrawnRef.current = onWithdrawn;
  });

  const ownerId = prompt?.documentId ?? null;
  const ownerPath = prompt?.path ?? null;
  const ownerOpen = useDocumentStore((state) =>
    ownerId === null ? true : state.documents.some((doc) => doc.id === ownerId),
  );

  useEffect(() => {
    if (ownerId === null || ownerPath === null || ownerOpen) return;
    setPrompt(null);
    loggingService.logDialogAction(WITHDRAW_CONTROL_ID, "cancel", {
      reason: WITHDRAW_REASON,
      documentId: ownerId,
    });
    onWithdrawnRef.current(ownerPath, ownerId);
  }, [ownerId, ownerPath, ownerOpen]);

  const raiseReload = useCallback((message: string, documentId: string, path: string, seq = 0) => {
    setPrompt((current) =>
      current &&
      current.message === message &&
      current.documentId === documentId &&
      current.path === path &&
      current.seq === seq
        ? current
        : { message, documentId, path, seq },
    );
  }, []);
  const dismissReload = useCallback((token?: ReloadPromptToken) => {
    setPrompt((current) =>
      !token || (current && current.documentId === token.documentId && current.seq === token.seq)
        ? null
        : current,
    );
  }, []);

  return { reloadMessage: prompt?.message ?? null, promptToken: prompt, raiseReload, dismissReload };
}
