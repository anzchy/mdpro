/**
 * Purpose: give a dialog its initial focus as one *visible* focus request —
 * `focus({ focusVisible: true })` on the target — so the rule 33 pattern 2 ring shows on
 * device (D53 ConfirmDialog; D63 ReloadDialog and McpWriteConfirmDialog).
 *
 * Key decisions:
 * - **Why `focusVisible: true`**: button rings key only on `:focus-visible`, and WKWebView
 *   does not treat a script/autofocus focus after a mouse interaction (click in the editor,
 *   then a shortcut) as focus-visible, so the dialog opened with no visible focus.
 * - **The caller must REMOVE `autoFocus`, not supplement it**: WebKit ignores `focusVisible`
 *   on an element that already has focus, and React's `autoFocus` focuses at commit, before
 *   this layout effect runs — so with both, this request is a no-op and the ring stays off.
 * - **`useLayoutEffect`, deps `[enabled, targetRef]`**: runs before paint, once per
 *   false → true transition of `enabled` (a refs object is stable), so an ordinary re-render
 *   while open never pulls focus back from where the user Tabbed to. Call it before any
 *   `if (!open) return null` early return (rules of hooks).
 * - **The target is the caller's choice**: this hook changes how focus is requested, never
 *   which control gets it. A ref with no element is a no-op.
 *
 * @coordinates-with src/components/common/ConfirmDialog.tsx — Cancel/Confirm by `destructive`
 * @coordinates-with src/components/common/ReloadDialog.tsx — Reload
 * @coordinates-with src/components/common/McpWriteConfirmDialog.tsx — Reject (ADR-0042 FT-1)
 * @coordinates-with tests/use-visible-initial-focus.test.tsx — VF-1 … VF-6
 */
import { useLayoutEffect, type RefObject } from "react";

/** `focusVisible` is not in this TS lib.dom yet; WebKit honours it (D53). */
const VISIBLE_FOCUS: FocusOptions & { focusVisible?: boolean } = { focusVisible: true };

/** While `enabled`, focus `targetRef.current` once, as visible focus; again on each re-enable. */
export function useVisibleInitialFocus(targetRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    targetRef.current?.focus(VISIBLE_FOCUS);
  }, [enabled, targetRef]);
}
