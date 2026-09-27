/**
 * @module useMilkdownScrollRestore
 * Purpose: when arriving in WYSIWYG after a mode switch, scroll to the anchor
 * captured on the outgoing Source view (WI-8). Modelled on
 * `useMilkdownTableCursorRestore`; registered AFTER it in MilkdownEditor.tsx
 * so the scroll wins over any cursor placement.
 *
 * Key decisions:
 *   - Deps are `[editor.loading, activeDocumentId]` (see the table-cursor hook's
 *     audit-fix M3: `editor` is a new wrapper every render).
 *   - **`loading === false` is not layout.** The restore waits at least two
 *     animation frames AND a scroller with `clientHeight > 0`, giving up after
 *     `SCROLL_RESTORE_MAX_FRAMES` (the view then stays at the top — today's
 *     behaviour).
 *   - **Re-pin through the settle window (D22).** `useMilkdownImages` swaps image
 *     sources to asset:// after render, and each decode can push the target down —
 *     several images, at different times. After a successful restore the hook arms
 *     `pinDuringLayoutSettle` (source `"restore"`) with the restore itself as the
 *     re-apply: every `.ProseMirror` resize, and every image `load` above the probe
 *     line, re-applies the anchor until `SCROLL_RESTORE_SETTLE_MS` after arm, when one
 *     final re-pin runs. The pin stands down the moment `scrollTop` is not its own, so
 *     a user who has scrolled is never yanked back; the effect cleanup disposes it.
 *   - **Logging never blocks the restore.** `logRestore` swallows logger failures, so a
 *     throwing logger cannot stop the pin from arming right after it.
 *
 * @coordinates-with src/utils/scrollAnchor/milkdown.ts
 * @coordinates-with src/utils/scrollAnchor/anchor.ts (the one-shot slot)
 * @coordinates-with src/utils/scrollAnchor/settlePin.ts (`pinDuringLayoutSettle`)
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx
 */

import { useEffect } from "react";
import type { useEditor } from "@milkdown/react";
import { editorViewCtx } from "@milkdown/kit/core";
import { loggingService } from "../services/loggingService";
import { consumePendingScrollAnchor, type ScrollAnchor } from "../utils/scrollAnchor/anchor";
import { SPY_ANCHOR_OFFSET_PX } from "../utils/codemirrorViewportLine";
import {
  resolveMilkdownScroller,
  restoreMilkdownScrollAnchor,
} from "../utils/scrollAnchor/milkdown";
import { pinDuringLayoutSettle, SETTLE_PIN_WINDOW_MS } from "../utils/scrollAnchor/settlePin";

type MilkdownEditorReturn = ReturnType<typeof useEditor>;

/** Frames to wait before the first apply: loaded ≠ laid out. */
export const SCROLL_RESTORE_MIN_FRAMES = 2;
/** Frames after which a never-laid-out scroller is abandoned. */
export const SCROLL_RESTORE_MAX_FRAMES = 60;
/** The restore's settle-pin window, from arm (the final re-pin runs at its end). */
export const SCROLL_RESTORE_SETTLE_MS = SETTLE_PIN_WINDOW_MS;

/** Never throws: it runs just before the pin is armed, and logging must not stop that. */
function logRestore(anchor: ScrollAnchor, status: "success" | "cancel", context: Record<string, unknown>): void {
  try {
    loggingService.logEventSync({
      level: "info",
      event: "editor.scroll_anchor.restore",
      status,
      actionId: loggingService.generateActionId(),
      context: { surface: "wysiwyg", documentId: anchor.documentId, ...context },
    });
  } catch {
    // Logging must never break scrolling (same rule as settlePin's `logSettle`).
  }
}

export function useMilkdownScrollRestore(
  editor: MilkdownEditorReturn,
  activeDocumentId: string | null,
): void {
  useEffect(() => {
    if (editor.loading) return;
    const instance = editor.get();
    if (!instance) return;
    const anchor = consumePendingScrollAnchor(activeDocumentId);
    if (!anchor) return;

    let frame = 0;
    let rafId = 0;
    let disposePin: (() => void) | undefined;

    const locate = () => {
      try {
        const view = instance.action((ctx) => ctx.get(editorViewCtx));
        const scroller = resolveMilkdownScroller(view);
        return scroller ? { view, scroller } : null;
      } catch {
        return null;
      }
    };

    const step = () => {
      frame++;
      const found = locate();
      if (frame < SCROLL_RESTORE_MIN_FRAMES || !found || found.scroller.clientHeight <= 0) {
        if (frame < SCROLL_RESTORE_MAX_FRAMES) rafId = requestAnimationFrame(step);
        else logRestore(anchor, "cancel", { reason: "no-layout", frames: frame });
        return;
      }
      const { view, scroller } = found;
      const applied = restoreMilkdownScrollAnchor(view, scroller, anchor);
      logRestore(anchor, applied ? "success" : "cancel", { frames: frame });
      if (!applied) return;
      disposePin = pinDuringLayoutSettle({
        scroller,
        observed: view.dom,
        source: "restore",
        windowMs: SCROLL_RESTORE_SETTLE_MS,
        reapply: () => restoreMilkdownScrollAnchor(view, scroller, anchor),
        // Only a load above the probe line can have moved the anchor.
        loadFilter: (el) =>
          el instanceof HTMLImageElement &&
          el.getBoundingClientRect().top < scroller.getBoundingClientRect().top + SPY_ANCHOR_OFFSET_PX,
      });
    };

    rafId = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafId);
      disposePin?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.loading, activeDocumentId]);
}
