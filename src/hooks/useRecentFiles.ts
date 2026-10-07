/**
 * Purpose: own the window's Recent Files list and keep it from clobbering the
 * stored list before preferences are read (ADR-0031 step 5a, WI-5, finding F1),
 * and display the session list Rust owns for the app-wide Open Recent menu
 * (D43, design b). A `file:open`, drag-drop or dialog open can land before
 * `get_preferences` resolves; computing from the empty initial list would
 * write a one-element list over the user's history.
 *
 * Pipeline: `updateRecentFiles(path)` → before hydration: buffer, no write, no
 *   sync → `hydrateRecentFiles(stored)` → local `mergePending(stored, buffer)`
 *   and one `seed{stored, pendingNewestFirst}` sync → after hydration: local
 *   `pushRecent` and one `record{path}` sync per update.
 *   `failRecentFilesHydration()` sends `seed{stored: null, …}`. Each sync reply
 *   that is the latest request's and non-null replaces the displayed list and
 *   is what gets written (a `null` reply writes the call-time local list); the
 *   seed writes only if the buffer was non-empty, a failure never writes.
 *
 * Key decisions:
 * - The list, the buffer and the hydrated latch live in refs updated
 *   synchronously inside each call, so consecutive updates with no re-render
 *   between them (e.g. `openPaths` over several files) compose from the latest
 *   list rather than the last rendered one.
 * - Hydration is a one-shot latch: a second hydrate, or a failure signalled
 *   after a successful hydrate, is ignored.
 * - Hydration failure (Amendment A2) keeps the buffered entries in memory and
 *   the failure itself writes nothing: `set_preferences` replaces
 *   `recentFiles` wholesale. Later updates do write, as after a successful
 *   hydration. It logs a count only, never a path.
 * - Sync sends deltas only, never this window's list (D43): a window's list
 *   lacks other windows' entries. `hydrate(undefined)` sends `stored: []`;
 *   only a failure sends `null`, which Rust logs as `hydration_failed`.
 *   `viewMode` is always `null` here; `useRecentFilesMenuRefresh` owns it.
 * - One per-instance request counter covers seed and record. A reply is
 *   adopted (display and `listRef`, so later local pushes build on it) only if
 *   it answers the latest request and is non-null; a superseded reply is
 *   discarded, and `null` (browser mode, rejected call) keeps the local list.
 * - Writes happen on the reply, not at call time (D43 WI-5): a non-null reply
 *   to the latest request writes the session list Rust returned, so this
 *   window no longer clobbers other windows' entries on disk. A `null` reply
 *   (browser mode, rejected call) writes the call-time local list, one write
 *   per update. Writes go out in request order: a reply older than the last
 *   written one writes nothing, and a superseded non-null reply never writes.
 *   Residual: writes from different windows can still reach disk out of order.
 * - Writes are fire-and-forget with `.catch`: `setPreferences` already logs and
 *   toasts a failure, then rethrows, which would otherwise be unhandled.
 * - All three callbacks keep a stable identity; App's `loadPreferences` effect
 *   lists the hydrate setter in its deps.
 *
 * @coordinates-with src/utils/recentFiles.ts
 * @coordinates-with src/services/recentFilesMenuService.ts
 * @coordinates-with src/App.tsx
 */
import { useCallback, useRef, useState } from "react";
import { preferencesService } from "../services/preferencesService";
import { loggingService } from "../services/loggingService";
import { syncRecentFilesMenu, type RecentOp } from "../services/recentFilesMenuService";
import { mergePending, pushRecent } from "../utils/recentFiles";

export interface RecentFilesApi {
  /** The displayed list, most recent first: the session list Rust last returned, else local. */
  recentFiles: string[];
  /** Record an opened or saved path. Buffered, without a write, until hydration. */
  updateRecentFiles: (path: string) => void;
  /** Apply the stored list read from preferences. Only the first call has effect. */
  hydrateRecentFiles: (stored: string[] | undefined) => void;
  /** Preferences could not be read: keep the buffer in memory, write nothing, seed with `stored: null`. */
  failRecentFilesHydration: () => void;
}

export function useRecentFiles(): RecentFilesApi {
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const listRef = useRef<string[]>([]);
  const pendingRef = useRef<string[]>([]);
  const hydratedRef = useRef(false);
  const requestRef = useRef(0);
  const writtenRef = useRef(0);

  const commit = useCallback((next: string[]) => {
    listRef.current = next;
    setRecentFiles(next);
  }, []);

  /**
   * Send `op`; adopt the reply only if it answers the latest request. With a
   * `local` list the reply is also written: the adopted reply, or `local` when
   * the reply is `null`. `local === null` means this request never writes.
   */
  const sync = useCallback(
    (op: RecentOp, local: string[] | null) => {
      requestRef.current += 1;
      const id = requestRef.current;
      void syncRecentFilesMenu(op, null).then((list) => {
        const latest = id === requestRef.current;
        if (list !== null && latest) commit(list);
        if (local === null || id <= writtenRef.current) return;
        if (list !== null && !latest) return;
        writtenRef.current = id;
        // setPreferences logs and toasts its own failure; swallow the rethrow.
        preferencesService.setPreferences({ recentFiles: list ?? local }).catch(() => undefined);
      });
    },
    [commit],
  );

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
      sync({ kind: "record", path }, next);
    },
    [commit, sync],
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
      const local = pending.length > 0 ? next : null;
      sync({ kind: "seed", stored: stored ?? [], pendingNewestFirst: pending }, local);
    },
    [commit, sync],
  );

  const failRecentFilesHydration = useCallback(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const pending = pendingRef.current;
    pendingRef.current = [];
    const next = mergePending([], pending);
    commit(next);
    loggingService.logEventSync({
      level: "warn",
      event: "preferences.recent_files.buffer",
      status: "fail",
      actionId: loggingService.generateActionId(),
      context: { outcome: "kept_in_memory", reason: "hydration_failed", count: next.length },
    });
    // A2: the failure itself never writes; `set_preferences` replaces wholesale.
    sync({ kind: "seed", stored: null, pendingNewestFirst: pending }, null);
  }, [commit, sync]);

  return { recentFiles, updateRecentFiles, hydrateRecentFiles, failRecentFilesHydration };
}
