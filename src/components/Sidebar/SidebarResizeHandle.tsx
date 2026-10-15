/**
 * Purpose: the sidebar's right-edge resize handle (D189, ADR-0088 decision
 * 3): a focusable vertical separator that carries the width and its range.
 * Behaviour lives in `useSidebarResize`; this file is the ARIA surface.
 *
 * @coordinates-with src/hooks/useSidebarResize.ts
 * @coordinates-with src/components/Sidebar/index.tsx
 */
import { useSidebarResize } from "../../hooks/useSidebarResize";
import {
  SIDEBAR_ELEMENT_ID,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type SidebarResizeSource,
} from "../../utils/sidebarWidth";

interface SidebarResizeHandleProps {
  /** The stored sidebar width. */
  width: number;
  /** Called once per settled resize. */
  onCommit: (width: number, source: SidebarResizeSource) => void;
}

export function SidebarResizeHandle({ width, onCommit }: SidebarResizeHandleProps) {
  const handlers = useSidebarResize({ width, onCommit });
  return (
    <div
      className="sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-controls={SIDEBAR_ELEMENT_ID}
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      tabIndex={0}
      {...handlers}
    />
  );
}
