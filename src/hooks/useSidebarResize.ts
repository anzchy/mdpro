/**
 * Purpose: the sidebar resize handle's pointer and keyboard behaviour (D189,
 * ADR-0088 decision 3), returned as the handle's event props.
 *
 * Pipeline: pointerdown (primary button) → capture the pointer, remember the
 *   start → each pointermove sets the app shell's `--sidebar-width` directly
 *   (clamped), with no React state and no preference write → pointerup,
 *   pointercancel or lostpointercapture ends the drag and calls `onCommit`
 *   once, only if the width moved. Keys and double-click call `onCommit` at
 *   once.
 *
 * Key decisions:
 * - The live width bypasses React so a drag never re-renders App per frame;
 *   only the settled width reaches the store, through `onCommit`.
 * - The drag starts from the sidebar's rendered width when it can be
 *   measured, so a sidebar narrowed by a small window does not jump. A drag
 *   that commits nothing puts the stored width back on the shell.
 * - A step that cannot move the width (already at an end, or Enter at the
 *   default) commits nothing; a handled key is always prevented.
 * - Arrow keys step from the drawn width, like a drag: when a narrow window
 *   has clamped the sidebar below its stored width, ← narrows what is seen,
 *   and → (which cannot widen it) commits nothing rather than lowering the
 *   stored width. Home, End and Enter name absolute widths (b137 M2).
 * - Unmounting mid-drag (the sidebar hidden while dragging) settles the drag
 *   once, like pointercancel (b137 M1).
 * - `valueNow` is the drawn width, kept current by a ResizeObserver where
 *   one exists, for the handle's `aria-valuenow`.
 *
 * @coordinates-with src/components/Sidebar/SidebarResizeHandle.tsx
 * @coordinates-with src/hooks/useSidebarPreference.ts
 * @coordinates-with src/utils/sidebarWidth.ts
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import {
  clampSidebarWidth,
  sidebarWidthForKey,
  SIDEBAR_WIDTH_DEFAULT,
  type SidebarResizeSource,
} from "../utils/sidebarWidth";

export interface SidebarResizeOptions {
  /** The stored width. */
  width: number;
  /** Called once per settled resize with the new width. */
  onCommit: (width: number, source: SidebarResizeSource) => void;
}

interface Drag {
  startX: number;
  startWidth: number;
  live: number;
  shell: HTMLElement | null;
}

const PRIMARY_BUTTON = 0;

function setShellWidth(shell: HTMLElement | null, width: number): void {
  shell?.style.setProperty("--sidebar-width", `${width}px`);
}

function renderedWidth(handle: HTMLElement, fallback: number): number {
  const measured = handle.parentElement?.getBoundingClientRect().width ?? 0;
  return measured > 0 ? Math.round(measured) : fallback;
}

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight"]);

export function useSidebarResize({ width, onCommit }: SidebarResizeOptions) {
  const dragRef = useRef<Drag | null>(null);
  const handleRef = useRef<HTMLElement | null>(null);
  const [drawn, setDrawn] = useState<number | null>(null);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.live !== drag.startWidth) onCommit(drag.live, "drag");
    else setShellWidth(drag.shell, width);
  }, [onCommit, width]);

  // M1: the latest endDrag, so the unmount cleanup settles with current props.
  const endDragRef = useRef(endDrag);
  endDragRef.current = endDrag;
  useEffect(() => () => endDragRef.current(), []);

  useEffect(() => {
    const sidebar = handleRef.current?.parentElement;
    if (!sidebar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const measured = Math.round(sidebar.getBoundingClientRect().width);
      setDrawn(measured > 0 ? measured : null);
    });
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== PRIMARY_BUTTON) return;
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture?.(e.pointerId);
      const startWidth = renderedWidth(handle, width);
      dragRef.current = {
        startX: e.clientX,
        startWidth,
        live: startWidth,
        shell: handle.closest<HTMLElement>(".app-shell"),
      };
    },
    [width],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.live = clampSidebarWidth(drag.startWidth + e.clientX - drag.startX);
    setShellWidth(drag.shell, drag.live);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const arrow = ARROW_KEYS.has(e.key);
      const base = arrow ? renderedWidth(e.currentTarget, width) : width;
      const next = sidebarWidthForKey(base, e.key, e.shiftKey);
      if (!next) return;
      e.preventDefault();
      const clampedByWindow = base < width;
      if (arrow && clampedByWindow && next.width > base) return;
      if (next.width !== width) onCommit(next.width, next.source);
    },
    [onCommit, width],
  );

  const onDoubleClick = useCallback(() => {
    if (width !== SIDEBAR_WIDTH_DEFAULT) onCommit(SIDEBAR_WIDTH_DEFAULT, "reset");
  }, [onCommit, width]);

  return {
    ref: handleRef,
    valueNow: drawn ?? width,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
    onKeyDown,
    onDoubleClick,
  };
}
