/**
 * @module hooks/useMenuEvents
 * Purpose: Subscribe the window to the native menu's `menu:action` broadcast
 * and dispatch each action to the matching App handler, logging one
 * `ui.menu.select` per dispatched action (with this window's `windowLabel`).
 *
 * Device evidence (D31 WI-2, info level, labels and counts only — no content,
 * no new path fields):
 *   - `ui.menu.select` context carries `windowLabel`, so a device log shows
 *     which window acted on each click.
 *   - one `ui.menu.listen` line per `listen()` attempt: `success` when it
 *     resolves while mounted, `cancel` when it resolves after cleanup (and is
 *     unlistened at once), `fail` when it rejects — cancelled or not.
 *   - one `ui.menu.focus_check` `fail` line per event whose focus check throws.
 *   Error fields are fixed reason strings, never the raw error. The `fail`
 *   lines stay at info level on purpose: both failures are recovered (no menu
 *   events, or fail-open), and the device check counts them, not alerts on them.
 *
 * Key decisions:
 *   - Subscribe ONCE per mount (`useEffect` with `[]` deps). Keying the
 *     subscription on handler identity re-subscribed on every App render, and
 *     each re-subscribe raced `listen()`; the leaked subscriptions made one
 *     click run its handler N times (D31).
 *   - Handlers live in a ref updated in `useLayoutEffect` (never during
 *     render), and `handleMenuAction` reads the ref AFTER the focus-check
 *     await, so the newest handlers run and no event is dropped across a
 *     re-render. An event still parked on that await at unmount is dropped.
 *   - A `cancelled` flag makes a `listen()` that resolves after cleanup call
 *     its unlisten at once (same shape as `useTheme.ts`), so StrictMode and
 *     fast unmounts leave nothing live.
 *   - The focus check fails open: if `isFocused()` throws, the window acts,
 *     and the failure is logged so a device run can see it.
 *   - The label is read per log line from `getCurrentWindow()` (a static
 *     import, like `useMcpSync.ts`); outside Tauri it falls back to "unknown".
 *   - Not unit-testable: two windows receiving one broadcast click (jsdom has
 *     one global `getCurrentWindow`, D30) — covered by the device run.
 *
 * @coordinates-with src-tauri/src/menu.rs — emits `menu:action` to every webview
 * @coordinates-with src/App.tsx — supplies the handlers
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ViewMode } from "../types/editor";
import type { UserPreferences } from "../types/preferences";
import { loggingService } from "../services/loggingService";

interface MenuActionPayload {
  action: string;
  value?: string | null;
}

interface MenuHandlers {
  onNew?: (actionId?: string) => void;
  onNewWindow?: (actionId?: string) => void;
  onOpen?: (actionId?: string) => void;
  onSave?: (actionId?: string) => void;
  onClose?: (actionId?: string) => void;
  onExportHtml?: (actionId?: string) => void;
  onOpenRecent?: (path: string, actionId?: string) => void;
  onToggleSidebar?: (actionId?: string) => void;
  onHighlight?: (actionId?: string) => void;
  onInsertTable?: (actionId?: string) => void;
  onViewModeChange?: (mode: ViewMode, actionId?: string) => void;
  onCycleViewMode?: (actionId?: string) => void;
  onThemeModeChange?: (mode: UserPreferences["themeMode"], actionId?: string) => void;
  onOpenPreferences?: (actionId?: string) => void;
}

const LISTEN_FAIL_REASON = "menu:action listen() rejected";
const FOCUS_CHECK_FAIL_REASON = "isFocused() rejected; failing open";

/** This window's label; "unknown" outside Tauri, where the getter throws. */
function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "unknown";
  }
}

/** One `ui.menu.<event>` line carrying only the window label. */
function logMenuLifecycle(
  event: "ui.menu.listen" | "ui.menu.focus_check",
  status: "success" | "cancel" | "fail",
  error?: string,
) {
  loggingService.logEventSync({
    level: "info",
    event,
    status,
    actionId: loggingService.generateActionId(),
    context: { windowLabel: windowLabel() },
    ...(error ? { error } : {}),
  });
}

export function useMenuEvents(menuHandlers: MenuHandlers) {
  const handlersRef = useRef(menuHandlers);
  useLayoutEffect(() => {
    handlersRef.current = menuHandlers;
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const shouldHandleMenuAction = async () => {
      try {
        return await getCurrentWindow().isFocused();
      } catch {
        logMenuLifecycle("ui.menu.focus_check", "fail", FOCUS_CHECK_FAIL_REASON);
        return true;
      }
    };

    const logMenuSelect = (controlId: string, context: Record<string, unknown> = {}) =>
      loggingService.logMenuSelect(controlId, { ...context, windowLabel: windowLabel() });

    const handleMenuAction = async ({ action, value }: MenuActionPayload) => {
      const canHandle = await shouldHandleMenuAction();
      // An event parked on the focus check must not act after unmount.
      if (!canHandle || cancelled) return;
      // Read after the await: the newest handlers, not the ones at emit time.
      const handlers = handlersRef.current;
      switch (action) {
        case "file.new":
          handlers.onNew?.(logMenuSelect("menu.file.new"));
          break;
        case "file.new_window":
          handlers.onNewWindow?.(logMenuSelect("menu.file.new_window"));
          break;
        case "file.open":
          handlers.onOpen?.(logMenuSelect("menu.file.open"));
          break;
        case "file.save":
          handlers.onSave?.(logMenuSelect("menu.file.save"));
          break;
        case "file.close":
          handlers.onClose?.(logMenuSelect("menu.file.close"));
          break;
        case "file.export_html":
          handlers.onExportHtml?.(logMenuSelect("menu.file.export_html"));
          break;
        case "file.preferences":
          handlers.onOpenPreferences?.(logMenuSelect("menu.file.preferences"));
          break;
        case "file.open_recent":
          if (value) {
            const actionId = logMenuSelect("menu.file.open_recent", {
              filePath: value,
            });
            handlers.onOpenRecent?.(value, actionId);
          }
          break;
        case "cycle-view-mode":
          handlers.onCycleViewMode?.(logMenuSelect("menu.view.cycle"));
          break;
        case "set-view-mode": {
          if (!value) break;
          const mode = value as ViewMode;
          if (mode === "wysiwyg" || mode === "source") {
            handlers.onViewModeChange?.(
              mode,
              logMenuSelect("menu.view.set_mode", { mode }),
            );
          }
          break;
        }
        case "view.toggle_sidebar":
          handlers.onToggleSidebar?.(logMenuSelect("menu.view.toggle_sidebar"));
          break;
        case "format.highlight":
          handlers.onHighlight?.(logMenuSelect("menu.format.highlight"));
          break;
        case "paragraph.table":
          // Wired to the same insert-table flow as the ⌘⌥T shortcut; both
          // open TableInsertModal via tableInsertStore.requestInsert.
          handlers.onInsertTable?.(logMenuSelect("menu.format.insert_table"));
          break;
        case "theme.light":
          handlers.onThemeModeChange?.(
            "light",
            logMenuSelect("menu.theme.light"),
          );
          break;
        case "theme.dark":
          handlers.onThemeModeChange?.(
            "dark",
            logMenuSelect("menu.theme.dark"),
          );
          break;
        case "theme.system":
          handlers.onThemeModeChange?.(
            "system",
            logMenuSelect("menu.theme.system"),
          );
          break;
        default:
          break;
      }
    };

    listen<MenuActionPayload>("menu:action", (event) => {
      void handleMenuAction(event.payload);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          logMenuLifecycle("ui.menu.listen", "cancel");
        } else {
          unlisten = fn;
          logMenuLifecycle("ui.menu.listen", "success");
        }
      })
      .catch(() => {
        // Menu events unavailable: nothing to dispatch; logged even after cleanup.
        logMenuLifecycle("ui.menu.listen", "fail", LISTEN_FAIL_REASON);
      });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);
}
