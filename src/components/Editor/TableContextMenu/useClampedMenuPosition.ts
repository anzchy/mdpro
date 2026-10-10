/**
 * @module TableContextMenu/useClampedMenuPosition
 * Purpose: Shared hook that positions a table context menu (WYSIWYG and
 * source mode) by its measured size (D67). Renders first at the anchor
 * clamped with an unknown height, then measures the mounted menu in a layout
 * effect and corrects the position before the browser paints.
 *
 * Key decisions:
 *   - The corrected position lives in this hook's own state, keyed on the
 *     anchor object's identity. The component's `menu` state is never
 *     recreated, so its focus-first-item and dismissal effects (keyed on
 *     `menu`) do not re-run when the position is corrected.
 *   - Width falls back to `MENU_WIDTH` when measurement returns 0.
 *   - State is only set when the measured clamp differs from the first pass,
 *     so a menu that already fits costs no extra render.
 *
 * @coordinates-with src/components/Editor/TableContextMenu/menuPosition.ts
 * @coordinates-with src/components/Editor/TableContextMenu/index.tsx
 * @coordinates-with src/components/Editor/SourceTableContextMenu/index.tsx
 */

import { type RefObject, useLayoutEffect, useState } from "react";
import { clampMenuPosition, MENU_WIDTH, type Point } from "./menuPosition";

interface Measured {
  anchor: Point;
  pos: Point;
}

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function firstPass(anchor: Point): Point {
  return clampMenuPosition(anchor, { width: MENU_WIDTH, height: 0 }, viewportSize());
}

/**
 * Returns the on-screen position for a menu opened at `anchor` (the raw
 * click point), or null when no menu is open. Pass a new anchor object per
 * open; the same object across renders means the same open menu.
 */
export function useClampedMenuPosition(
  menuRef: RefObject<HTMLElement | null>,
  anchor: Point | null,
): Point | null {
  const [measured, setMeasured] = useState<Measured | null>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!anchor || !el) return;
    const rect = el.getBoundingClientRect();
    const size = { width: rect.width || MENU_WIDTH, height: rect.height };
    const pos = clampMenuPosition(anchor, size, viewportSize());
    const initial = firstPass(anchor);
    if (pos.x !== initial.x || pos.y !== initial.y) {
      setMeasured({ anchor, pos });
    }
  }, [anchor, menuRef]);

  if (!anchor) return null;
  if (measured && measured.anchor === anchor) return measured.pos;
  return firstPass(anchor);
}
