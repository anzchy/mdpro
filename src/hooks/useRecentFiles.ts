/**
 * Purpose: own the window's Recent Files list and keep it from clobbering the
 * stored list before preferences are read (ADR-0031 step 5a, WI-5, finding F1).
 * A `file:open`, drag-drop or dialog open can land before `get_preferences`
 * resolves; computing from the empty initial list would write a one-element
 * list over the user's history.
 *
 * Pipeline: `updateRecentFiles(path)` → before hydration: buffer, no write →
 *   `hydrateRecentFiles(stored)` → `mergePending(stored, buffer)`, one write only
 *   if the buffer was non-empty → after hydration: `pushRecent` + one write per
 *   update, as before the extraction.
 *
 * Key decisions:
 * - The list, the buffer and the hydrated latch live in refs updated
 *   synchronously inside each call, so consecutive updates with no re-render
 *   between them (e.g. `openPaths` over several files) compose from the latest
 *   list rather than the last rendered one.
 * - Hydration is a one-shot latch: a second hydrate, or a failure signalled
 *   after a successful hydrate, is ignored.
 * - Hydration failure (Amendment A2) keeps the buffered entries in memory and
 *   writes nothing: `set_preferences` replaces `recentFiles` wholesale, and a
 *   write without a known stored baseline is the clobber this hook exists to
 *   prevent. It logs a count only, never a path.
 * - Writes are fire-and-forget with `.catch`: `setPreferences` already logs and
 *   toasts a failure, then rethrows, which would otherwise be unhandled.
 * - All three callbacks keep a stable identity; App's `loadPreferences` effect
 *   lists the hydrate setter in its deps.
 *
 * @coordinates-with src/utils/recentFiles.ts
 * @coordinates-with src/App.tsx
 */
import { useCallback, useRef, useState } from "react";
import { preferencesService } from "../services/preferencesService";
import { loggingService } from "../services/loggingService";
import { mergePending, pushRecent } from "../utils/recentFiles";

export interface RecentFilesApi {
  /** The current list, most recent first; feeds the Recent Files menu. */
  recentFiles: string[];
  /** Record an opened or saved path. Buffered, without a write, until hydration. */
  updateRecentFiles: (path: string) => void;
  /** Apply the stored list read from preferences. Only the first call has effect. */
  hydrateRecentFiles: (stored: string[] | undefined) => void;
  /** Preferences could not be read: keep the buffer in memory, write nothing. */
  failRecentFilesHydration: () => void;
}

export function useRecentFiles(): RecentFilesApi {
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const listRef = useRef<string[]>([]);
  const pendingRef = useRef<string[]>([]);
  const hydratedRef = useRef(false);

  const commit = useCallback((next: string[]) => {
    listRef.current = next;
    setRecentFiles(next);
  }, []);

  const updateRecentFiles = useCallback(
    (path: string) => {
      if (!path) return;
      if (!hydratedRef.current) {
        pendingRef.current = [path, ...pendingRef.current];
        commit(pushRecent(listRef.current, path));
        return;
      }
      const next = pushRecent(listRef.current, path);
      commit(next);
      // setPreferences logs and toasts its own failure; swallow the rethrow.
      preferencesService.setPreferences({ recentFiles: next }).catch(() => undefined);
    },
    [commit],
  );

  const hydrateRecentFiles = useCallback(
    (stored: string[] | undefined) => {
      if (hydratedRef.current) return;
      hydratedRef.current = true;
      const pending = pendingRef.current;
      pendingRef.current = [];
      const next = mergePending(stored ?? [], pending);
      commit(next);
      // Hydration never writes what it just read; only a non-empty buffer adds
      // something the disk does not hold.
      if (pending.length > 0) {
        // setPreferences logs and toasts its own failure; swallow the rethrow.
        preferencesService.setPreferences({ recentFiles: next }).catch(() => undefined);
      }
    },
    [commit],
  );

  const failRecentFilesHydration = useCallback(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const next = mergePending([], pendingRef.current);
    pendingRef.current = [];
    commit(next);
    loggingService.logEventSync({
      level: "warn",
      event: "preferences.recent_files.buffer",
      status: "fail",
      actionId: loggingService.generateActionId(),
      context: { outcome: "kept_in_memory", reason: "hydration_failed", count: next.length },
    });
  }, [commit]);

  return { recentFiles, updateRecentFiles, hydrateRecentFiles, failRecentFilesHydration };
}
