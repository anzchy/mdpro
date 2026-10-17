/**
 * @module hooks/useMenuEvents
 * Purpose: Subscribe the window to the native menu's `menu:action` broadcast
 * and hand each focused-window event to `dispatchMenuAction`
 * (menuActionTable.ts), which runs the matching App handler and logs one
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
 *   - The action table (which action reaches which handler, the D165 / D235
 *     modal refusals, the Open Recent and view-mode value checks) lives in
 *     `menuActionTable.ts` (D261-WI-1a). This hook owns only the subscription,
 *     the focus check and the logging helpers; it passes `logMenuSelect`, which
 *     stamps this window's label on every select line.
 *   - Not unit-testable: two windows receiving one broadcast click (jsdom has
 *     one global `getCurrentWindow`, D30) — covered by the device run.
 *
 * @coordinates-with src-tauri/src/menu.rs — emits `menu:action` to every webview
 * @coordinates-with src/App.tsx — supplies the handlers
 * @coordinates-with src/hooks/menuActionTable.ts — dispatchMenuAction, the action table and modal refusals
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loggingService } from "../services/loggingService";
import { dispatchMenuAction, type MenuActionPayload, type MenuHandlers } from "./menuActionTable";

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

    const handleMenuAction = async (payload: MenuActionPayload) => {
      const canHandle = await shouldHandleMenuAction();
      // An event parked on the focus check must not act after unmount.
      if (!canHandle || cancelled) return;
      // Read after the await: the newest handlers, not the ones at emit time.
      const handlers = handlersRef.current;
      dispatchMenuAction(payload, handlers, logMenuSelect);
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
