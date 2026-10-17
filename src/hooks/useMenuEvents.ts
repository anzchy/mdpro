/**
 * @module hooks/useMenuEvents
 * Purpose: Subscribe this window to the native menu's `menu:action` events,
 * which Rust sends with `emit_to` to exactly one window (D261), and hand each
 * one addressed to this window to `dispatchMenuAction` (menuActionTable.ts)
 * with a menu-target token captured at receipt. The table runs the matching
 * App handler and logs one `ui.menu.select` per dispatched action, with this
 * window's `windowLabel`.
 *
 * Device evidence (D31 WI-2, D261; info level, labels and counts only — no
 * content, no new path fields):
 *   - `ui.menu.select` context carries `windowLabel`, so a device log shows
 *     which window acted on each click.
 *   - one `ui.menu.select` `cancel` line `{ windowLabel, reason: "wrong_target" }`
 *     per payload whose `target` is not this window's label (missing included).
 *   - one `ui.menu.listen` line per `listen()` attempt: `success` when it
 *     resolves while mounted, `cancel` when it resolves after cleanup (and is
 *     unlistened at once), `fail` when it rejects — cancelled or not. The `fail`
 *     reason is a fixed string, never the raw error, and stays at info level:
 *     it is recovered (no menu events) and counted, not alerted on.
 *
 * Key decisions:
 *   - Subscribe ONCE per mount (`useEffect` with `[]` deps). Keying the
 *     subscription on handler identity re-subscribed on every App render, and
 *     each re-subscribe raced `listen()`; the leaked subscriptions made one
 *     click run its handler N times (D31).
 *   - Subscribe through `getCurrentWindow().listen`, never the global `listen`
 *     of `@tauri-apps/api/event`: a global (`Any`) listener matches every
 *     targeted emit, so it would hear clicks meant for other windows.
 *   - Fail closed on the target: the label is read once at mount (a window's
 *     label never changes), and a payload whose `target` differs, or is
 *     missing, runs nothing. There is no focus query: Rust already chose the
 *     window, and focus may have moved since the click.
 *   - The token is captured synchronously at each receipt, before anything can
 *     await, and passed to every handler after its actionId. Handlers that
 *     mutate later check it with `abandonIfStale` (menuTargetToken.ts).
 *   - Handlers live in a ref updated in `useLayoutEffect` (never during
 *     render), read at dispatch, so the newest handlers run.
 *   - A `cancelled` flag makes a `listen()` that resolves after cleanup call
 *     its unlisten at once (same shape as `useTheme.ts`), and stops an event
 *     delivered in that gap from dispatching, so StrictMode and fast unmounts
 *     leave nothing live.
 *   - The action table (which action reaches which handler, the D165 / D235
 *     modal refusals, the Open Recent and view-mode value checks) lives in
 *     `menuActionTable.ts` (D261-WI-1a).
 *
 * @coordinates-with src-tauri/src/menu_target.rs — resolves the target window and `emit_to`s it
 * @coordinates-with src-tauri/src/menu.rs — the menu items and their action strings
 * @coordinates-with src/App.tsx — supplies the handlers
 * @coordinates-with src/hooks/menuActionTable.ts — dispatchMenuAction, the action table and modal refusals
 * @coordinates-with src/utils/menuTargetToken.ts — captureToken, the token handlers receive
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loggingService } from "../services/loggingService";
import { currentWindowLabel } from "../utils/currentWindowLabel";
import { captureToken } from "../utils/menuTargetToken";
import { dispatchMenuAction, type MenuActionPayload, type MenuHandlers } from "./menuActionTable";

const LISTEN_FAIL_REASON = "menu:action listen() rejected";

/** One `ui.menu.<event>` line carrying only the window label. */
function logMenuLine(
  event: "ui.menu.listen" | "ui.menu.select",
  status: "success" | "cancel" | "fail",
  context: Record<string, unknown>,
  error?: string,
) {
  loggingService.logEventSync({
    level: "info",
    event,
    status,
    actionId: loggingService.generateActionId(),
    context,
    ...(error ? { error } : {}),
  });
}

/** `getCurrentWindow().listen`, with a synchronous throw turned into a rejection. */
function listenOnThisWindow(onPayload: (payload: MenuActionPayload) => void): Promise<() => void> {
  try {
    return getCurrentWindow().listen<MenuActionPayload>("menu:action", (event) => onPayload(event.payload));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function useMenuEvents(menuHandlers: MenuHandlers) {
  const handlersRef = useRef(menuHandlers);
  useLayoutEffect(() => {
    handlersRef.current = menuHandlers;
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    // Once per mount: a real window's label never changes.
    const label = currentWindowLabel();

    const logMenuSelect = (controlId: string, context: Record<string, unknown> = {}) =>
      loggingService.logMenuSelect(controlId, { ...context, windowLabel: label });

    const handleMenuAction = (payload: MenuActionPayload) => {
      // Delivered between a late resolve and its unlisten: this mount is gone.
      if (cancelled) return;
      if (payload.target !== label) {
        logMenuLine("ui.menu.select", "cancel", { windowLabel: label, reason: "wrong_target" });
        return;
      }
      // Synchronously at receipt: the document and editor the click was made against.
      const token = captureToken(label);
      dispatchMenuAction(payload, handlersRef.current, logMenuSelect, token);
    };

    listenOnThisWindow(handleMenuAction)
      .then((fn) => {
        if (cancelled) {
          fn();
          logMenuLine("ui.menu.listen", "cancel", { windowLabel: label });
        } else {
          unlisten = fn;
          logMenuLine("ui.menu.listen", "success", { windowLabel: label });
        }
      })
      .catch(() => {
        // Menu events unavailable: nothing to dispatch; logged even after cleanup.
        logMenuLine("ui.menu.listen", "fail", { windowLabel: label }, LISTEN_FAIL_REASON);
      });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);
}
