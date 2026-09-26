/**
 * Purpose: read this webview window's Tauri label for log context, degrading to
 * "unknown" instead of throwing when the window API is unavailable.
 *
 * @module src/utils/currentWindowLabel
 * @coordinates-with src/hooks/useFileWatcher.ts — `file.change.received` lines.
 * @coordinates-with src/hooks/useFileChangeDecisionLog.ts — `file.change.decision` lines.
 *
 * Key decisions:
 * - **Read on every call, never cached.** The label is static per window, so the
 *   read is cheap; not caching means a transient failure never sticks.
 * - **Never throws.** A diagnostic line must not cost the render or the event
 *   it describes.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";

export const UNKNOWN_WINDOW_LABEL = "unknown";

export function currentWindowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return UNKNOWN_WINDOW_LABEL;
  }
}
