/**
 * Purpose: App's by-path opens — `handleOpenPath` (Open Recent, drop), `openPaths`
 * (cold-launch and Finder `file:open`) and `openDroppedMarkdown` (the drop's open
 * loop and its `file.open.drop` logs). Extracted from App.tsx (D125) so they can be
 * tested against the real `useDocument` and open-write guard.
 *
 * Pipeline: path → actionId (the caller's, or one generated per path, D126)
 * → `openPathOutcome(path, actionId)` → recent file recorded for every
 * open that opened → follow-up (default view mode, `onOpened`) only when `activated`.
 *
 * Key decisions:
 * - The recent-files update runs for every open that returned a document, activated
 *   or not: the file did open (D95). Only the view-mode follow-up waits for
 *   `activated`, so a D92-refused open is not refused a second time.
 * - The default view mode applies once, after the first activated drop, through an
 *   `onFirstSuccess` latch: a drop whose every open fails or is refused leaves the
 *   current document's mode untouched (D51, D95).
 * - `file.open.drop` keeps `success` / `fail` for "the open happened" and carries the
 *   shared activation fields from `openActivationContext` (D125, ADR-0071 decision 3).
 * - None of these callbacks toasts or reports a failed open: `openPathOutcome`
 *   already did (D46).
 *
 * @coordinates-with src/hooks/useDocument.ts — openPathOutcome
 * @coordinates-with src/utils/onFirstSuccess.ts — the once-only view-mode latch
 * @coordinates-with src/utils/openActivationLog.ts — the outcome log's activation fields
 * @coordinates-with src/App.tsx — handleOpenRecent, handleFileDrop, checkLaunchPaths
 * @coordinates-with src/hooks/useFileOpenEvent.ts — handleFileOpenEvent (Finder open while running)
 */
import { useCallback } from "react";
import type { OpenPathOutcome } from "./useDocument";
import { loggingService } from "../services/loggingService";
import { onFirstSuccess } from "../utils/onFirstSuccess";
import { openActivationContext } from "../utils/openActivationLog";
import type { ViewMode } from "../types/editor";

export interface UseOpenPathsOptions {
  openPathOutcome: (path: string, actionId?: string) => Promise<OpenPathOutcome | null>;
  updateRecentFiles: (path: string) => void;
  setBusyLabel: (label: string | null) => void;
  defaultViewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export function useOpenPaths({
  openPathOutcome,
  updateRecentFiles,
  setBusyLabel,
  defaultViewMode,
  setViewMode,
}: UseOpenPathsOptions) {
  /** Opens one path under the busy label; resolves to `{ document, activated }` or null (D95). */
  const handleOpenPath = useCallback(
    async (path: string, actionId?: string) => {
      setBusyLabel("Opening file...");
      try {
        const opened = await openPathOutcome(path, actionId);
        if (opened?.document.path) {
          updateRecentFiles(opened.document.path);
        }
        return opened;
      } finally {
        setBusyLabel(null);
      }
    },
    [openPathOutcome, setBusyLabel, updateRecentFiles],
  );

  /**
   * Opens each path in turn, each under its own generated actionId so the read and the
   * guard's `file.open.*` log join up (D126). `onOpened` runs after each file that opened AND became
   * active (never for a failed open, nor for one whose activation a failed WYSIWYG
   * flush refused, D95); callers pass an `onFirstSuccess` latch to act once (D51).
   */
  const openPaths = useCallback(
    async (paths: string[], onOpened?: () => void) => {
      for (const path of paths) {
        try {
          const opened = await openPathOutcome(path, loggingService.generateActionId());
          if (opened?.document.path) {
            updateRecentFiles(opened.document.path);
          }
          if (opened?.activated) {
            onOpened?.();
          }
        } catch {
          // Ignore launch open errors.
        }
      }
    },
    [openPathOutcome, updateRecentFiles],
  );

  /**
   * Opens dropped Markdown files in this window, logging `file.open.drop` start and
   * outcome per file under one actionId that also reaches the read.
   */
  const openDroppedMarkdown = useCallback(
    async (mdPaths: string[]) => {
      const applyDefaultViewMode = onFirstSuccess(() => setViewMode(defaultViewMode));
      for (const filePath of mdPaths) {
        const actionId = loggingService.generateActionId();
        loggingService.logEventSync({
          level: "info",
          event: "file.open.drop",
          status: "start",
          actionId,
          context: { filePath, fileCount: mdPaths.length, dropTarget: "window" },
        });
        const opened = await handleOpenPath(filePath, actionId);
        if (opened?.activated) {
          applyDefaultViewMode();
        }
        loggingService.logEventSync({
          level: opened ? "info" : "error",
          event: "file.open.drop",
          status: opened ? "success" : "fail",
          actionId,
          context: { filePath, openedInNewWindow: false, ...openActivationContext(opened) },
          error: opened ? undefined : "open failed",
        });
      }
    },
    [defaultViewMode, handleOpenPath, setViewMode],
  );

  return { handleOpenPath, openPaths, openDroppedMarkdown };
}
