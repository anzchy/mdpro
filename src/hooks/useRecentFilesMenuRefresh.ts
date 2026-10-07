/**
 * Purpose: rebuild the Open Recent menu when this window's view mode changes,
 * without sending a list (D43). The menu carries the View checkmark, so a mode
 * change needs a rebuild; the session list itself is owned by Rust.
 *
 * Pipeline: `viewMode` change → `syncRecentFilesMenu({ kind: "refresh" }, viewMode)`.
 *
 * Key decisions:
 * - The only frontend caller that sends a real mode. Rust remembers it, and
 *   `seed` / `record` calls from `useRecentFiles` send `null` so they never
 *   reset the checkmark.
 * - The reply is ignored: a refresh does not change the list, and the window's
 *   displayed list comes from `useRecentFiles` alone.
 * - Fire-and-forget: the wrapper never rejects, and logs its own failure.
 *
 * @coordinates-with src/services/recentFilesMenuService.ts
 * @coordinates-with src/App.tsx
 */
import { useEffect } from "react";
import { syncRecentFilesMenu } from "../services/recentFilesMenuService";
import type { ViewMode } from "../types/editor";

export function useRecentFilesMenuRefresh(viewMode: ViewMode): void {
  useEffect(() => {
    void syncRecentFilesMenu({ kind: "refresh" }, viewMode);
  }, [viewMode]);
}
