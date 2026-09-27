/**
 * Purpose: the close-time save of the global window state (`main` only) and the
 * active document's per-file geometry. Extracted from `useWindowCloseGuard.ts`
 * (ADR-0031 step 5b) to keep that hook under the 300-line limit.
 *
 * Pipeline: window-API reads (scale, inner size, outer position, maximized) →
 * one `physicalToLogical` conversion → `preferencesService.saveWindowState`
 * (main) or an enum-only `skipped`/`not_main` log (other windows) →
 * `windowService.saveWindowGeometry` for the active document, read at call time.
 *
 * Key decisions:
 * - **Never rejects.** It runs inside the `onCloseRequested` handler; a
 *   rejection would take the close guard down with it.
 * - **Stage-typed, enum-only failure log.** Every failure produces exactly one
 *   `window.save_state` fail entry whose context is `{ reason }`, naming the
 *   stage that failed: `geometry_read_failed` (the window-API reads),
 *   `save_rejected` (`save_window_state`) or `geometry_save_rejected`
 *   (`save_window_geometry`). The rejection text is never logged — Rust errors
 *   can carry filesystem paths (ADR-0031 step 5b, matrix W1).
 * - A failed dynamic import of `windowService` is reported as `geometry_save_rejected`.
 * - **All-or-nothing (WI3-K).** A failed global write skips the per-file
 *   geometry write, so the two records never disagree. See the hook header.
 *
 * @module src/hooks/saveWindowStateOnClose
 * @coordinates-with src/hooks/useWindowCloseGuard.ts — the only caller
 * @coordinates-with src/services/preferencesService.ts — `saveWindowState`
 * @coordinates-with src/services/windowService.ts — per-file geometry
 * @coordinates-with src/utils/windowGeometry.ts — `ownsGlobalWindowState`,
 *   `physicalToLogical`
 */
import { loggingService } from "../services/loggingService";
import { preferencesService } from "../services/preferencesService";
import { useDocumentStore } from "../stores/documentStore";
import { ownsGlobalWindowState, physicalToLogical } from "../utils/windowGeometry";

/** The stage a close-time save failed in; the only thing its fail log carries. */
export type WindowSaveFailureReason = "geometry_read_failed" | "save_rejected" | "geometry_save_rejected";

/** Persist window state (`main` only) + the active document's geometry. Never rejects. */
export async function saveWindowStateOnClose(): Promise<void> {
  let stage: WindowSaveFailureReason = "geometry_read_failed";
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const currentWindow = getCurrentWindow();
    // `scaleFactor()` is awaited FIRST, before either write. A rejection here
    // must leave both records untouched rather than land a physical one with
    // no matching geometry — a worse state than doing nothing (WI3-D).
    const scaleFactor = await currentWindow.scaleFactor();
    const size = await currentWindow.innerSize();
    const position = await currentWindow.outerPosition();
    const isMaximized = await currentWindow.isMaximized();
    // Physical pixels in, logical points out — see the hook header's D-c note.
    // One conversion, both payloads.
    const logical = physicalToLogical(
      { x: position.x, y: position.y, width: size.width, height: size.height },
      scaleFactor,
    );
    // Only `main` writes the global record (ADR-0037 Decision 3). Decided after
    // the scale read, so every window keeps the WI3-D order.
    if (ownsGlobalWindowState(currentWindow.label)) {
      stage = "save_rejected";
      await preferencesService.saveWindowState({
        width: logical.width,
        height: logical.height,
        x: logical.x,
        y: logical.y,
        isMaximized,
      });
    } else {
      loggingService.logEventSync({
        level: "info",
        event: "window.save_state",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: { outcome: "skipped", reason: "not_main" },
      });
    }

    // Read the active document NOW, not from a render closure: the hook
    // subscribes once, so a captured value would be whatever was open when the
    // listener was installed (WI-6 Rev 1).
    const activeDocument = useDocumentStore.getState().getActiveDocument();
    if (activeDocument?.path) {
      stage = "geometry_save_rejected";
      const { windowService } = await import("../services/windowService");
      await windowService.saveWindowGeometry(activeDocument.path, {
        x: logical.x,
        y: logical.y,
        width: logical.width,
        height: logical.height,
      });
    }
  } catch {
    // Not swallowed: WI-1 made `save_window_state` able to fail for a real
    // reason (a corrupt config.json), and a silent loss of the user's window
    // position is what rule 20 exists to make visible. Enum-only context.
    loggingService.logEventSync({
      level: "error",
      event: "window.save_state",
      status: "fail",
      actionId: loggingService.generateActionId(),
      context: { reason: stage },
    });
  }
}
