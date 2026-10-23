/**
 * Purpose: report this window's view mode, tab count and, when App opts in,
 * its theme mode on change and focus. Reports are serialized to preserve tick order.
 * Rust owns the session list and binds the report to the injected caller.
 *
 * Pipeline: mode or tab-count change / native focus → typed `syncRecentFilesMenu` refresh.
 *
 * Key decisions:
 * - `seed` / `record` calls from `useRecentFiles` send `null`; only this hook
 *   reports a mode. Focus callback reads the latest mode from a ref.
 * - The reply is ignored: a refresh does not change the list, and the window's
 *   displayed list comes from `useRecentFiles` alone.
 * - Fire-and-forget: the wrapper never rejects, and logs its own failure.
 *
 * @coordinates-with src/services/recentFilesMenuService.ts
 * @coordinates-with src/App.tsx
 */
import { useCallback, useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { syncRecentFilesMenu } from "../services/recentFilesMenuService";
import { loggingService } from "../services/loggingService";
import type { ViewMode } from "../types/editor";
import type { UserPreferences } from "../types/preferences";
import { useThemeStore } from "../stores/themeStore";

type ThemeMode = UserPreferences["themeMode"];

export function useRecentFilesMenuRefresh(viewMode: ViewMode, themeMode?: ThemeMode, tabCount?: number): () => void {
  const latestMode = useRef({ viewMode, themeMode, tabCount });
  latestMode.current = { viewMode, themeMode, tabCount };
  const includeTheme = useRef(themeMode !== undefined);
  includeTheme.current = themeMode !== undefined;
  const themeOnFocus = useRef(false);
  const pending = useRef<{ mode: ViewMode; source: "change" | "focus"; withTheme: boolean; tabCount?: number }[]>([]);
  const reporting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reportMode = useCallback((mode: ViewMode, source: "change" | "focus", withTheme: boolean, count?: number) => {
    if (!isTauri()) return;
    const send = async (next: { mode: ViewMode; source: "change" | "focus"; withTheme: boolean; tabCount?: number }): Promise<void> => {
      if (!mounted.current) {
        reporting.current = false;
        pending.current = [];
        return;
      }
      // The first report starts now, preserving the old mount/seed order.
      // Later reports wait for its install and read the current theme then.
      const confirmedMode = next.withTheme ? useThemeStore.getState().mode : undefined;
      const actionId = loggingService.generateActionId();
      loggingService.logEventSync({
        level: "info", event: "ui.menu.mode_report", status: "start",
        actionId, context: { source: next.source, mode: next.mode },
      });
      const list = await syncRecentFilesMenu({ kind: "refresh" }, next.mode, confirmedMode, next.tabCount);
      loggingService.logEventSync({
        level: list ? "info" : "error", event: "ui.menu.mode_report",
        status: list ? "success" : "fail", actionId,
        context: { source: next.source, mode: next.mode },
      });
      const following = pending.current.shift();
      if (following) void send(following);
      else reporting.current = false;
    };
    const next = { mode, source, withTheme, tabCount: count };
    if (reporting.current) pending.current.push(next);
    else {
      reporting.current = true;
      void send(next);
    }
  }, []);
  useEffect(() => {
    reportMode(viewMode, "change", includeTheme.current, tabCount);
  }, [viewMode, themeMode, tabCount, reportMode]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const logFailure = () => {
      loggingService.logEventSync({
        level: "error", event: "ui.menu.mode_listener", status: "fail",
        actionId: loggingService.generateActionId(), context: { reason: "subscribe_failed" },
      });
    };
    try {
      void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (!focused || disposed) return;
        reportMode(latestMode.current.viewMode, "focus", includeTheme.current || themeOnFocus.current, latestMode.current.tabCount);
      }).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      }).catch(logFailure);
    } catch {
      logFailure();
    }
    return () => { disposed = true; unlisten?.(); };
  }, [reportMode]);
  return useCallback(() => {
    themeOnFocus.current = true;
    reportMode(latestMode.current.viewMode, "change", true, latestMode.current.tabCount);
  }, [reportMode]);
}
