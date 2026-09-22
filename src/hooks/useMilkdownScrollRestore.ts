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
 *   - **One settle re-apply.** `useMilkdownImages` swaps image sources to
 *     asset:// after render, which can push the target down. The first image
 *     `load` above the probe line, or `SCROLL_RESTORE_SETTLE_MS`, re-applies
 *     once — and only if `scrollTop` is still what the restore set, so a user
 *     who has already scrolled is never yanked back (and if the engine's own
 *     scroll anchoring moved `scrollTop`, the position is already held).
 *
 * @coordinates-with src/utils/scrollAnchor/milkdown.ts
 * @coordinates-with src/utils/scrollAnchor/anchor.ts (the one-shot slot)
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx
 */

import { useEffect } from "react";
import type { useEditor } from "@milkdown/react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { loggingService } from "../services/loggingService";
import { consumePendingScrollAnchor, type ScrollAnchor } from "../utils/scrollAnchor/anchor";
import { SPY_ANCHOR_OFFSET_PX } from "../utils/codemirrorViewportLine";
import {
  resolveMilkdownScroller,
  restoreMilkdownScrollAnchor,
} from "../utils/scrollAnchor/milkdown";

type MilkdownEditorReturn = ReturnType<typeof useEditor>;

/** Frames to wait before the first apply: loaded ≠ laid out. */
export const SCROLL_RESTORE_MIN_FRAMES = 2;
/** Frames after which a never-laid-out scroller is abandoned. */
export const SCROLL_RESTORE_MAX_FRAMES = 60;
/** The one settle re-apply fires at the latest after this delay. */
export const SCROLL_RESTORE_SETTLE_MS = 500;

function logRestore(anchor: ScrollAnchor, status: "success" | "cancel", context: Record<string, unknown>): void {
  loggingService.logEventSync({
    level: "info",
    event: "editor.scroll_anchor.restore",
    status,
    actionId: loggingService.generateActionId(),
    context: { surface: "wysiwyg", documentId: anchor.documentId, ...context },
  });
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let appliedTop = 0;
    let target: { view: EditorView; scroller: HTMLElement } | null = null;

    const locate = () => {
      try {
        const view = instance.action((ctx) => ctx.get(editorViewCtx));
        const scroller = resolveMilkdownScroller(view);
        return scroller ? { view, scroller } : null;
      } catch {
        return null;
      }
    };

    const settle = () => {
      if (settled || !target) return;
      settled = true;
      clearTimeout(timer);
      target.scroller.removeEventListener("load", onLoad, true);
      if (target.scroller.scrollTop !== appliedTop) return;
      restoreMilkdownScrollAnchor(target.view, target.scroller, anchor);
    };

    function onLoad(event: Event): void {
      if (!target || !(event.target instanceof HTMLImageElement)) return;
      const probeY = target.scroller.getBoundingClientRect().top + SPY_ANCHOR_OFFSET_PX;
      if (event.target.getBoundingClientRect().top < probeY) settle();
    }

    const step = () => {
      frame++;
      const found = locate();
      if (frame < SCROLL_RESTORE_MIN_FRAMES || !found || found.scroller.clientHeight <= 0) {
        if (frame < SCROLL_RESTORE_MAX_FRAMES) rafId = requestAnimationFrame(step);
        else logRestore(anchor, "cancel", { reason: "no-layout", frames: frame });
        return;
      }
      target = found;
      const applied = restoreMilkdownScrollAnchor(found.view, found.scroller, anchor);
      logRestore(anchor, applied ? "success" : "cancel", { frames: frame });
      if (!applied) return;
      appliedTop = found.scroller.scrollTop;
      found.scroller.addEventListener("load", onLoad, true);
      timer = setTimeout(settle, SCROLL_RESTORE_SETTLE_MS);
    };

    rafId = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
      target?.scroller.removeEventListener("load", onLoad, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.loading, activeDocumentId]);
}
