/**
 * Purpose: report this window's mode when it changes or gains focus (M3a).
 * Rust owns the session list and binds the report to the injected caller.
 *
 * Pipeline: mode change / native focus → typed `syncRecentFilesMenu` refresh.
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
import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { syncRecentFilesMenu } from "../services/recentFilesMenuService";
import { loggingService } from "../services/loggingService";
import type { ViewMode } from "../types/editor";

function reportMode(mode: ViewMode, source: "change" | "focus"): void {
  if (!isTauri()) return;
  const actionId = loggingService.generateActionId();
  loggingService.logEventSync({
    level: "info", event: "ui.menu.mode_report", status: "start",
    actionId, context: { source, mode },
  });
  void syncRecentFilesMenu({ kind: "refresh" }, mode).then((list) => {
    loggingService.logEventSync({
      level: list ? "info" : "error", event: "ui.menu.mode_report",
      status: list ? "success" : "fail", actionId,
      context: { source, mode },
    });
  });
}

export function useRecentFilesMenuRefresh(viewMode: ViewMode): void {
  const latestMode = useRef(viewMode);
  latestMode.current = viewMode;
  useEffect(() => {
    reportMode(viewMode, "change");
  }, [viewMode]);

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
        reportMode(latestMode.current, "focus");
      }).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      }).catch(logFailure);
    } catch {
      logFailure();
    }
    return () => { disposed = true; unlisten?.(); };
  }, []);
}
