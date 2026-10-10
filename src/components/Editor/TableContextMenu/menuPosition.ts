/**
 * @module TableContextMenu/menuPosition
 * Purpose: Pure viewport clamp shared by both table context menus (WYSIWYG
 * `TableContextMenu` and source-mode `SourceTableContextMenu`). Given the
 * right-click anchor, the menu's measured size and the viewport size, it
 * returns the top-left position that keeps the whole menu on screen.
 *
 * Key decisions:
 *   - D67: clamp by the menu's ACTUAL rendered height. The old clamp
 *     subtracted a constant 480 px, but the 15-item menu is taller, so a
 *     right-click in the lower part of an 800 px window pushed the
 *     destructive group below the window bottom.
 *   - A menu taller than the padded viewport pins to the top padding; the
 *     CSS `max-height: calc(100vh - 16px); overflow-y: auto` then scrolls it.
 *   - The result is never below `VIEWPORT_PADDING` on either axis, even for
 *     a viewport narrower or shorter than the menu.
 *   - Pure (no `window` reads) so it is testable without a DOM; the hook
 *     `useClampedMenuPosition` supplies the measured and viewport sizes.
 *
 * @coordinates-with src/components/Editor/TableContextMenu/useClampedMenuPosition.ts
 * @coordinates-with src/components/Editor/TableContextMenu/index.tsx
 * @coordinates-with src/components/Editor/SourceTableContextMenu/index.tsx
 * @coordinates-with src/styles/sections/table-context-menu.css — max-height + scroll
 */

/** Fixed menu width in px; also the width fallback when measurement returns 0. */
export const MENU_WIDTH = 220;
/** Minimum gap in px between the menu and every viewport edge. */
export const VIEWPORT_PADDING = 8;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

function clampAxis(anchor: number, extent: number, viewportExtent: number): number {
  const max = viewportExtent - extent - VIEWPORT_PADDING;
  return Math.max(VIEWPORT_PADDING, Math.min(anchor, max));
}

/**
 * Clamp a menu anchored at `anchor` so a box of `size` stays inside
 * `viewport` minus `VIEWPORT_PADDING` on every side. When the box cannot fit
 * on an axis, that axis pins to `VIEWPORT_PADDING`.
 */
export function clampMenuPosition(anchor: Point, size: Size, viewport: Size): Point {
  return {
    x: clampAxis(anchor.x, size.width, viewport.width),
    y: clampAxis(anchor.y, size.height, viewport.height),
  };
}
