/**
 * @module utils/sidebarWidth
 * Purpose: the sidebar width's range, default and keyboard steps (D189,
 * ADR-0088), as pure functions shared by the store, the preference hook and
 * the resize handle.
 *
 * Key decisions:
 * - The range and default mirror `src-tauri/src/models/sidebar_width.rs`;
 *   Rust clamps again on read and at `set_preferences`.
 * - A value that is not a finite number reads as the default, not as an end
 *   of the range: it has no meaningful position in it.
 *
 * @coordinates-with src-tauri/src/models/sidebar_width.rs
 * @coordinates-with src/hooks/useSidebarPreference.ts
 * @coordinates-with src/hooks/useSidebarResize.ts
 */
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 480;
export const SIDEBAR_WIDTH_DEFAULT = 220;
/** Arrow-key step, and the Shift+arrow step, in CSS px. */
export const SIDEBAR_WIDTH_STEP = 8;
export const SIDEBAR_WIDTH_BIG_STEP = 32;

/** The sidebar element's id, which the toggle and the handle name in `aria-controls`. */
export const SIDEBAR_ELEMENT_ID = "app-sidebar";

/** What settled a resize; logged as `ui.sidebar.resize`'s `source`. */
export type SidebarResizeSource = "drag" | "keyboard" | "reset";

/** Rounds and clamps `raw` into the range; anything else is the default. */
export function clampSidebarWidth(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(raw)));
}

/** The width a key on the resize handle asks for, or null if the key is not a resize key. */
export function sidebarWidthForKey(
  width: number,
  key: string,
  shiftKey: boolean,
): { width: number; source: SidebarResizeSource } | null {
  const step = shiftKey ? SIDEBAR_WIDTH_BIG_STEP : SIDEBAR_WIDTH_STEP;
  switch (key) {
    case "ArrowLeft":
      return { width: clampSidebarWidth(width - step), source: "keyboard" };
    case "ArrowRight":
      return { width: clampSidebarWidth(width + step), source: "keyboard" };
    case "Home":
      return { width: SIDEBAR_WIDTH_MIN, source: "keyboard" };
    case "End":
      return { width: SIDEBAR_WIDTH_MAX, source: "keyboard" };
    case "Enter":
      return { width: SIDEBAR_WIDTH_DEFAULT, source: "reset" };
    default:
      return null;
  }
}
