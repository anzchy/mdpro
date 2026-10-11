/**
 * Purpose: open the document named by a secondary window's `?open=` URL
 * parameter, once preferences are hydrated (ADR-0031 step 5a, WI-1). Moved out
 * of App.tsx; the `?open=` URL is built for every secondary window
 * (`open_route/tauri_glue.rs`).
 *
 * Pipeline: mount → wait for `preferencesLoaded` → log `app.url_param_check`
 *   → with `?open=`: `setViewMode(defaultViewMode)` → `openPathOutcome(path, actionId)`
 *   → `updateRecentFiles(document.path)` → `replaceState` clears the query.
 *
 * Key decisions:
 * - Hydration gate: nothing runs until `preferencesLoaded`, mirroring the
 *   launch-paths gate in App.tsx. Before it, `defaultViewMode` is the store
 *   default rather than the user's, and a recent-files write has no stored
 *   baseline. `loadPreferences` sets the flag in `finally`, so it cannot hang.
 * - Once per mount: a ref latches the first gated run, so later changes to
 *   `defaultViewMode` (e.g. from Settings) or callback identities never
 *   re-open the document or re-apply the view mode. The latest callbacks are
 *   read through a ref, so the effect depends on the gate alone.
 * - The query is kept until hydration (consuming it early would lose the open)
 *   and cleared after the open attempt, success or not.
 * - The view mode is set BEFORE the open, not gated on `activated` after it (D126):
 *   the window is fresh, so there is no current document for the switch to touch,
 *   and loading the document first in the store's mode and switching afterwards is
 *   the ADR-0063 table-cell loss the latch in `onFirstSuccess` avoids elsewhere.
 * - Opens through `openPathOutcome` like every other by-path open (D126): the
 *   outcome log keeps `success` for "a document came back" and adds the shared
 *   activation fields (`activated`, `reason: "flush-failed"` on a D92 refusal); the
 *   recent file is recorded for every open that opened, activated or not (D95).
 *   The start log, the read and the outcome share one actionId.
 * - Logs carry the window label, a presence flag and the file basename
 *   (pre-existing, finding F7); never the full path.
 *
 * @coordinates-with src/App.tsx
 * @coordinates-with src/hooks/useRecentFiles.ts
 * @coordinates-with src/hooks/useDocument.ts — openPathOutcome
 * @coordinates-with src/utils/openActivationLog.ts — the outcome log's activation fields
 */
import { useEffect, useRef } from "react";
import { loggingService } from "../services/loggingService";
import { openActivationContext } from "../utils/openActivationLog";
import type { OpenPathOutcome } from "./useDocument";
import type { ViewMode } from "../types/editor";

export interface OpenUrlParamOptions {
  preferencesLoaded: boolean;
  defaultViewMode: ViewMode;
  openPathOutcome: (path: string, actionId?: string) => Promise<OpenPathOutcome | null>;
  setViewMode: (mode: ViewMode) => void;
  updateRecentFiles: (path: string) => void;
}

export function useOpenUrlParam(options: OpenUrlParamOptions): void {
  const { preferencesLoaded } = options;
  const latestRef = useRef(options);
  latestRef.current = options;
  const ranRef = useRef(false);

  useEffect(() => {
    if (!preferencesLoaded || ranRef.current) return;
    ranRef.current = true;
    const { defaultViewMode, openPathOutcome, setViewMode, updateRecentFiles } =
      latestRef.current;
    const checkUrlParam = async () => {
      const params = new URLSearchParams(window.location.search);
      const openPath = params.get("open");

      // Get window label for logging
      let windowLabel = "unknown";
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        windowLabel = getCurrentWindow().label;
      } catch {
        // Ignore
      }

      // Log URL parameter check for debugging (info level to ensure visibility)
      // Note: only log whether a param is present, not the full URL or path (privacy)
      loggingService.logEventSync({
        level: "info",
        event: "app.url_param_check",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: {
          windowLabel,
          hasOpenParam: !!openPath,
        },
      });

      if (openPath) {
        const actionId = loggingService.generateActionId();
        const fileBasename = openPath.split("/").pop() ?? openPath;
        loggingService.logEventSync({
          level: "info",
          event: "file.open.url_param",
          status: "start",
          actionId,
          context: { windowLabel, fileBasename },
        });

        // Use default view mode from preferences for externally opened files
        setViewMode(defaultViewMode);
        const opened = await openPathOutcome(openPath, actionId);
        const doc = opened?.document ?? null;
        loggingService.logEventSync({
          level: doc ? "info" : "error",
          event: "file.open.url_param",
          status: doc ? "success" : "fail",
          actionId,
          context: {
            windowLabel,
            fileBasename,
            documentId: doc?.id || null,
            hasContent: doc ? doc.content.length > 0 : false,
            ...openActivationContext(opened),
          },
          error: doc ? undefined : "open returned nothing",
        });
        if (doc?.path) {
          updateRecentFiles(doc.path);
        }
        // Clean up the URL to prevent re-opening on refresh
        window.history.replaceState({}, "", window.location.pathname);
      }
    };
    void checkUrlParam();
  }, [preferencesLoaded]);
}
