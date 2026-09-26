/**
 * Purpose: Pure physical <-> logical window-geometry conversion and work-area
 * clamping for window save/restore (ADR-0031, WI-2). Stored `windowState` /
 * per-file geometry is written in *logical* points; the Tauri v2 window APIs
 * that read the live window (`innerSize`, `outerPosition`) report *physical*
 * pixels. On a 2x Retina display the two differ by exactly the backing scale
 * factor, which is why real `~/.mdpro/config.json` files hold 2x-inflated
 * records such as `{x:200, y:200, width:2400, height:1600}`.
 *
 * Pipeline: physical pixels (Tauri) -> physicalToLogical -> stored logical
 * points -> clampToWorkArea (against the current monitor) -> LogicalSize /
 * LogicalPosition applied to the window.
 *
 * Key decisions:
 * - **Purity.** This module imports nothing — no `@tauri-apps/*`, no store, no
 *   service. It is unit-testable with zero mocks, and WI-3 is the only place
 *   allowed to wire it to a window handle.
 * - **Rounding rule: `Math.round` (ties away from zero toward +Infinity), in
 *   both directions.** This is not incidental. The round-trip law below is
 *   satisfiable only by a rule whose error is bounded by 0.5 in physical space;
 *   `Math.floor` / `Math.trunc` / `| 0` / `parseInt` all violate it (e.g.
 *   width 601 at scale 1.5: floor gives 901 -> 600.67 -> 600 != 601, while
 *   round gives 902 -> 601.33 -> 601).
 * - **Round-trip law, and where it stops holding.** For every integer geometry
 *   `g` and every `scaleFactor s >= 1`,
 *   `physicalToLogical(logicalToPhysical(g, s), s)` deep-equals `g`. The
 *   `s >= 1` restriction is not a weakening: no macOS backing-scale factor is
 *   below 1. The law is genuinely **false** for `s < 1` and has never been
 *   tested there — do not rely on it in that range.
 * - **Degenerate scale factors fall back to 1; they never throw.** A
 *   `scaleFactor` of `0`, a negative, `NaN`, `Infinity`, `undefined` or `null`
 *   yields the geometry unchanged rather than `NaN` / `Infinity` coordinates.
 *   Restoring a window at the wrong scale is recoverable by dragging it; a
 *   `NaN` position hands the window server garbage, and a throw on the save
 *   path would lose the geometry entirely.
 * - **`minSize` beats the work area when the two conflict.** On a work area
 *   smaller than `minSize`, `clampToWorkArea` returns `minSize` rather than a
 *   rectangle the OS would reject against `min_inner_size`
 *   (`apply_resolved` in `src-tauri/src/services/window_restore.rs`, which
 *   applies `MIN_WINDOW_SIZE` from `src-tauri/src/services/window_geometry.rs`).
 *   Containment is therefore an invariant *with a precondition*: it holds
 *   whenever a rectangle of at least `minSize` fits.
 * - **The global `windowState` is `main`'s alone** (D24 WI-4, ADR-0037).
 *   `ownsGlobalWindowState` is the gate and `windowStateAction` the decision;
 *   every non-`main` window gets `skip`.
 * - **Every returned field is an integer**, including from the clamp — a
 *   `LogicalPosition` accepts a float, so a half-pixel would otherwise reach
 *   the window server unnoticed.
 *
 * @module src/utils/windowGeometry
 * @coordinates-with src/hooks/useWindowCloseGuard.ts (save path, WI-3)
 * @coordinates-with src/services/windowStateApplier.ts (restore path: the
 *   `main`-only gate and action of D24 WI-4 are interpreted there)
 * @coordinates-with src-tauri/src/commands/window.rs (per-file geometry, WI-3)
 */

/** A window rectangle in a single, consistent unit (all-physical or all-logical). */
export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A monitor's usable area, in logical points, origin included (may be negative). */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A minimum window size floor, in logical points. */
export interface WindowSize {
  width: number;
  height: number;
}

/**
 * The floor `clampToWorkArea` applies when no `minSize` is passed. Mirrors
 * `MIN_WINDOW_SIZE` (`src-tauri/src/services/window_geometry.rs`), which
 * `apply_resolved` (`src-tauri/src/services/window_restore.rs`) passes to
 * `min_inner_size`; the two must change together.
 */
export const DEFAULT_MIN_WINDOW_SIZE: WindowSize = { width: 600, height: 400 };

/**
 * Coerce a scale factor to a usable positive finite number. Exported for the
 * monitor work-area conversion in `src/services/windowStateApplier.ts`.
 *
 * @returns `scaleFactor` when it is finite and positive, otherwise `1`.
 */
export function normalizeScaleFactor(scaleFactor: number): number {
  return Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
}

/**
 * Convert a physical-pixel rectangle to logical points.
 *
 * Divides every field — position as well as size — by the scale factor and
 * rounds half-up. A degenerate `scaleFactor` falls back to `1`, returning the
 * input rounded rather than `NaN` / `Infinity`.
 */
export function physicalToLogical(
  geometry: WindowGeometry,
  scaleFactor: number,
): WindowGeometry {
  const scale = normalizeScaleFactor(scaleFactor);
  return {
    x: Math.round(geometry.x / scale),
    y: Math.round(geometry.y / scale),
    width: Math.round(geometry.width / scale),
    height: Math.round(geometry.height / scale),
  };
}

/**
 * Convert a logical-point rectangle to physical pixels.
 *
 * The exact inverse of {@link physicalToLogical} for integer geometries at any
 * `scaleFactor >= 1`. A degenerate `scaleFactor` falls back to `1`.
 */
export function logicalToPhysical(
  geometry: WindowGeometry,
  scaleFactor: number,
): WindowGeometry {
  const scale = normalizeScaleFactor(scaleFactor);
  return {
    x: Math.round(geometry.x * scale),
    y: Math.round(geometry.y * scale),
    width: Math.round(geometry.width * scale),
    height: Math.round(geometry.height * scale),
  };
}

/**
 * Project a logical rectangle onto the set of rectangles that are at least
 * `minSize` and, where possible, fully inside `workArea`.
 *
 * Size is capped to the work area and floored at `minSize` (the floor wins),
 * then position is moved the minimum distance needed to bring the rectangle
 * inside. Every returned field is an integer, and the operation is idempotent:
 * `clamp(clamp(g)) === clamp(g)`.
 *
 * @param minSize floor for the returned size; defaults to
 *   {@link DEFAULT_MIN_WINDOW_SIZE}. Read from the argument, never from a
 *   module constant — WI-3's Rust mirror passes a different value.
 */
export function clampToWorkArea(
  geometry: WindowGeometry,
  workArea: WorkArea,
  minSize: WindowSize = DEFAULT_MIN_WINDOW_SIZE,
): WindowGeometry {
  const areaLeft = Math.round(workArea.x);
  const areaTop = Math.round(workArea.y);
  const areaWidth = Math.round(workArea.width);
  const areaHeight = Math.round(workArea.height);

  const width = Math.max(
    Math.round(minSize.width),
    Math.min(Math.round(geometry.width), areaWidth),
  );
  const height = Math.max(
    Math.round(minSize.height),
    Math.min(Math.round(geometry.height), areaHeight),
  );

  // When the floor made the rectangle wider than the work area there is no
  // in-bounds position; pin it to the origin rather than pushing it negative.
  const maxX = Math.max(areaLeft, areaLeft + areaWidth - width);
  const maxY = Math.max(areaTop, areaTop + areaHeight - height);

  return {
    x: Math.min(Math.max(Math.round(geometry.x), areaLeft), maxX),
    y: Math.min(Math.max(Math.round(geometry.y), areaTop), maxY),
    width,
    height,
  };
}

/**
 * A stored window record: a logical rectangle plus the maximized flag.
 * Structurally identical to `WindowState` in `src/types/preferences.ts`,
 * declared here so this module keeps importing nothing.
 */
export interface WindowStateRecord extends WindowGeometry {
  isMaximized: boolean;
}

/** What hydration should do to the current window with the global record. */
export type WindowStateAction =
  | { kind: "skip" }
  | { kind: "maximize" }
  | { kind: "set"; geometry: WindowGeometry };

/**
 * The Tauri label of the one window that owns the global `windowState`
 * (ADR-0037). The label string is a contract with `tauri.conf.json`.
 */
export const GLOBAL_WINDOW_STATE_OWNER = "main";

/**
 * Whether the window with `label` owns the global `windowState`.
 *
 * Exact equality with `"main"`: no prefix, case-folding or trimming. Every
 * other window's geometry belongs to the Rust builder (per-file restore or
 * the cascaded default), so hydration must not move it.
 */
export function ownsGlobalWindowState(label: string): boolean {
  return label === GLOBAL_WINDOW_STATE_OWNER;
}

/**
 * Decide what hydration does with the global `windowState`.
 *
 * Non-owners always `skip`, checked before `isMaximized` so a maximized
 * `main` never maximizes a secondary window. For the owner: `maximize` when
 * the record is maximized, otherwise a `set` clamped against `workArea`, or
 * against the record itself when no monitor was reported (the size floor
 * still applies and nothing moves off a display the app cannot see).
 * `set` is a fixed point: re-applying it yields the same geometry.
 */
export function windowStateAction(
  owner: boolean,
  state: WindowStateRecord,
  workArea: WorkArea | null,
): WindowStateAction {
  if (!owner) return { kind: "skip" };
  if (state.isMaximized) return { kind: "maximize" };
  const record: WindowGeometry = {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
  };
  return { kind: "set", geometry: clampToWorkArea(record, workArea ?? record) };
}
