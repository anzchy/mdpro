/**
 * Purpose: Apply the global `windowState` preference to the current window
 * during App hydration, but only in `main` (D24, plan-20260926 WI-4). Extracted
 * from `App.tsx#applyWindowState` so the effect is unit-testable without
 * rendering App.
 *
 * Pipeline: `getCurrentWindow().label` → `ownsGlobalWindowState` (the gate)
 *   → for the owner, `currentMonitor()` → logical work area (or `null`)
 *   → `windowStateAction` → `skip` | `maximize()` |
 *   `setSize` + `setPosition` with the clamped geometry → one `window.apply_state`
 *   entry per branch (including the failure path) → the action carried out is
 *   returned by `applyAndReportWindowState` (`null` if it could not run).
 *
 * Key decisions:
 * - **Non-`main` windows are never moved by hydration.** Their geometry
 *   belongs to the Rust builder (per-file restore or the cascaded default).
 *   Before this gate every window was forced to the global record, which put
 *   Finder-opened and ⌘⇧N windows at 100,100 (D24 Finding 0).
 * - **The gate is not re-implemented here**: the label goes through
 *   `ownsGlobalWindowState`, and the decision through `windowStateAction`.
 * - The stored record is (outer position, inner size) in logical points — see
 *   the D-c note in `src/hooks/useWindowCloseGuard.ts`. `setSize` takes an
 *   inner size and `setPosition` an outer position, so the frames match; the
 *   clamp keeps a pre-WI-3 record (2x inflated on Retina) from opening a
 *   window larger than the display (ADR-0031 decision D-a).
 * - **Never throws.** Outside Tauri (`pnpm dev`) the window API throws; that
 *   is swallowed so `loadPreferences` still hydrates theme and editor prefs.
 * - A degenerate monitor `scaleFactor` (0, negative, `NaN`, `Infinity`) is
 *   treated as 1 via `normalizeScaleFactor`, the rule the geometry module
 *   already applies; `Infinity` once produced a 0x0 work area.
 * - `applyWindowState` stays `void` for its caller; the action is exposed by
 *   `applyAndReportWindowState` so tests can assert what was carried out.
 * - **Every call logs exactly one `window.apply_state` entry** (D24 WI-5,
 *   ADR-0032 GA-12), with enum-only context: `skipped`/`not_main`,
 *   `maximized`, `applied` with `monitor: "reported" | "absent"`, or `failed`.
 *   No geometry, label, monitor name or error text is logged. The success
 *   outcomes are logged only after the window calls resolve, so a rejection
 *   never leaves an `applied` entry behind. `failed` is logged at **warn**, never
 *   error: outside Tauri it is the expected path. There is no `no_state`
 *   outcome, because `windowState` is never absent (plan O-3).
 *
 * @module src/services/windowStateApplier
 * @coordinates-with src/App.tsx (called from `loadPreferences`)
 * @coordinates-with src/utils/windowGeometry.ts (gate, action and clamp)
 */
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import type { WindowState } from "../types/preferences";
import {
  normalizeScaleFactor,
  ownsGlobalWindowState,
  windowStateAction,
  type WindowStateAction,
  type WorkArea,
} from "../utils/windowGeometry";
import { loggingService } from "./loggingService";

type Monitor = Awaited<ReturnType<typeof currentMonitor>>;

/** Convert a monitor's physical work area to logical points; `null` stays `null`. */
function logicalWorkArea(monitor: Monitor): WorkArea | null {
  if (!monitor) return null;
  const scale = normalizeScaleFactor(monitor.scaleFactor);
  return {
    x: monitor.workArea.position.x / scale,
    y: monitor.workArea.position.y / scale,
    width: monitor.workArea.size.width / scale,
    height: monitor.workArea.size.height / scale,
  };
}

/**
 * Apply the global `windowState` to the current window if it is `main`;
 * otherwise log a skip and leave the window where the builder put it.
 *
 * @returns the action carried out — `skip`, `maximize`, or the clamped `set` —
 *   or `null` when it could not run (outside Tauri, or a window call threw).
 *   Never rejects.
 */
export async function applyAndReportWindowState(
  state: WindowState,
): Promise<WindowStateAction | null> {
  try {
    const currentWindow = getCurrentWindow();
    const owner = ownsGlobalWindowState(currentWindow.label);
    // The monitor is only needed for an owner's `set`; skip the query otherwise.
    const workArea = owner && !state.isMaximized ? logicalWorkArea(await currentMonitor()) : null;
    const action = windowStateAction(owner, state, workArea);
    switch (action.kind) {
      case "skip":
        logApplyState("info", "success", { outcome: "skipped", reason: "not_main" });
        return action;
      case "maximize":
        await currentWindow.maximize();
        logApplyState("info", "success", { outcome: "maximized" });
        return action;
      case "set":
        await currentWindow.setSize(new LogicalSize(action.geometry.width, action.geometry.height));
        await currentWindow.setPosition(new LogicalPosition(action.geometry.x, action.geometry.y));
        // Logged only after both calls resolved, so a rejection never leaves an `applied` entry.
        logApplyState("info", "success", { outcome: "applied", monitor: workArea ? "reported" : "absent" });
        return action;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  } catch {
    // The window API is unavailable outside Tauri; hydration must continue.
    // Warn, not error: this is expected under `pnpm dev`. No error text is logged.
    logApplyState("warn", "fail", { outcome: "failed" });
    return null;
  }
}

/** Enum-only context of a `window.apply_state` entry — no geometry, label or monitor name. */
type ApplyStateContext =
  | { outcome: "skipped"; reason: "not_main" }
  | { outcome: "maximized" }
  | { outcome: "applied"; monitor: "reported" | "absent" }
  | { outcome: "failed" };

/** Emit the single `window.apply_state` entry for one `applyAndReportWindowState` call. */
function logApplyState(level: "info" | "warn", status: "success" | "fail", context: ApplyStateContext): void {
  loggingService.logEventSync({
    level,
    event: "window.apply_state",
    status,
    actionId: loggingService.generateActionId(),
    context,
  });
}

/**
 * Apply the global `windowState` to the current window (see
 * {@link applyAndReportWindowState}), discarding the action. This is the
 * `App.tsx#loadPreferences` entry point; it resolves `undefined` in every case,
 * including outside Tauri.
 */
export async function applyWindowState(state: WindowState): Promise<void> {
  await applyAndReportWindowState(state);
}
