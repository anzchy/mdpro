/**
 * Purpose: open the document named by a secondary window's `?open=` URL
 * parameter, once preferences are hydrated (ADR-0031 step 5a, WI-1). Moved out
 * of App.tsx; the `?open=` URL is built for every secondary window
 * (`open_route/tauri_glue.rs`).
 *
 * Pipeline: mount → wait for `preferencesLoaded` → log `app.url_param_check`
 *   → with `?open=`: `setViewMode(defaultViewMode)` → `openDocumentFromPath`
 *   → `updateRecentFiles(doc.path)` → `replaceState` clears the query.
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
 * - Logs carry the window label, a presence flag and the file basename
 *   (pre-existing, finding F7); never the full path.
 *
 * @coordinates-with src/App.tsx
 * @coordinates-with src/hooks/useRecentFiles.ts
 */
import { useEffect, useRef } from "react";
import { loggingService } from "../services/loggingService";
import type { Document } from "../types/document";
import type { ViewMode } from "../types/editor";

export interface OpenUrlParamOptions {
  preferencesLoaded: boolean;
  defaultViewMode: ViewMode;
  openDocumentFromPath: (path: string, actionId?: string) => Promise<Document | null>;
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
    const { defaultViewMode, openDocumentFromPath, setViewMode, updateRecentFiles } =
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
        const doc = await openDocumentFromPath(openPath, actionId);
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
          },
          error: doc ? undefined : "openDocumentFromPath returned null",
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
