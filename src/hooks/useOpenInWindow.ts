/**
 * Purpose: the webview half of D29 (ADR-0033). When Finder or a second launch opens a
 * file that some window already has, Rust sends `file:open-in-window` to that window
 * alone; this hook receives it and focuses the tab, or reopens the path when the tab
 * has gone since Rust looked.
 *
 * Pipeline: `getCurrentWebviewWindow().listen(OPEN_IN_WINDOW_EVENT)` → validate the
 * payload (three non-empty strings) → drop it unless `windowLabel` is this window's
 * label → `useDocumentStore.getState()` has `documentId`?
 *   yes → set the active id in `documentStore` and `editorStore` (no I/O); D92: when
 *         the WYSIWYG flush failed, `documentStore` refuses and `editorStore` is left
 *         alone too (route logged as `fail`, the refusal toast comes from the store)
 *   no  → the injected `openDocumentFromPath(path)`, so the ADR-0028 guard decides.
 *
 * Key decisions:
 * - **Focus by id, never by path, and never reload.** The id came from the shadow
 *   store, so it names the exact tab the user has; a reload would clobber dirty edits
 *   and a path lookup would miss aliases (`/private/...`). Nothing else in
 *   `editorStore` is touched — reusing the `file:open` handler would reset the view
 *   mode (ADR-0033).
 * - **The store is read when the event arrives.** The subscription is made once, so a
 *   closure over render-time `documents` would be permanently stale.
 * - **Subscribe per webview, exactly once, with a `cancelled` flag** (as in
 *   `useQuitGuard`). The global `listen` would hear events addressed to other windows.
 *   The callback is held in a ref so a new identity never re-subscribes.
 * - **`routable` is true only after `listen` resolved while mounted.** It goes into the
 *   sync payload (WI-6): Rust must not route to a window that cannot hear it yet.
 * - **The label is re-checked** even though `emit_to` already targets this window.
 * - **A failed reopen is reported by `openDocumentFromPath`, not here.** That hook shows
 *   the one "Failed to open file" toast (D46); this handler logs the route fail only, so
 *   a failure never toasts twice.
 * - **Logs carry ids, the label and the outcome — never content.** Under Tauri, a
 *   failed subscription writes one `file.open.route.listen` fail, carrying the
 *   rejection (or getter) error message in `context.error`.
 * - **The webview getter is guarded.** Outside Tauri (`pnpm dev` web preview)
 *   `getCurrentWebviewWindow()` throws synchronously; an effect that throws unmounts
 *   the whole React root, and App mounts this hook unconditionally. A throwing getter
 *   is treated as a failed subscription: `routable` stays false, same log rule.
 *
 * @module src/hooks/useOpenInWindow
 * @coordinates-with src-tauri/src/services/open_route/payload.rs — event name and payload keys
 * @coordinates-with src/hooks/useDocument.ts — openDocumentFromPath (the ADR-0028 guard)
 * @coordinates-with src/stores/documentStore.ts — setActiveDocumentId
 * @coordinates-with src/stores/editorStore.ts — setActiveDocumentId
 */
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { useEditorStore } from "../stores/editorStore";

/** The event `src-tauri/src/services/open_route/payload.rs` emits. */
export const OPEN_IN_WINDOW_EVENT = "file:open-in-window";

const ROUTE_LOG_EVENT = "file.open.route";
const LISTEN_LOG_EVENT = "file.open.route.listen";

export interface OpenInWindowOptions {
  /**
   * `useDocument().openDocumentFromPath`; resolves to the document, or `null` on failure.
   * A failed reopen gets its "Failed to open file" toast from that hook (D46); the route
   * handler only logs the `file.open.route` fail and adds no toast of its own.
   */
  openDocumentFromPath: (path: string) => Promise<unknown>;
}

export interface OpenInWindowState {
  /** True once this webview is subscribed to `file:open-in-window`. */
  routable: boolean;
}

interface OpenInWindowPayload {
  windowLabel: string;
  documentId: string;
  path: string;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/** The payload, or `null` unless it carries three non-empty strings. */
function parsePayload(payload: unknown): OpenInWindowPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { windowLabel, documentId, path } = payload as Record<string, unknown>;
  if (!isNonEmptyString(windowLabel) || !isNonEmptyString(documentId) || !isNonEmptyString(path)) {
    return null;
  }
  return { windowLabel, documentId, path };
}

function logRoute(
  status: "success" | "fail" | "cancel",
  context: Record<string, unknown>,
  error?: string,
): void {
  loggingService.logEventSync({
    level: status === "success" ? "info" : "warn",
    event: ROUTE_LOG_EVENT,
    status,
    actionId: loggingService.generateActionId(),
    context,
    error,
  });
}

export function useOpenInWindow({ openDocumentFromPath }: OpenInWindowOptions): OpenInWindowState {
  const [routable, setRoutable] = useState(false);
  const openRef = useRef(openDocumentFromPath);
  useLayoutEffect(() => {
    openRef.current = openDocumentFromPath;
  }, [openDocumentFromPath]);

  useEffect(() => {
    // `listen` resolves after an await; a teardown that beats it must not leave the
    // handler registered or flip `routable` on an unmounted window.
    let cancelled = false;
    let dispose: (() => void) | null = null;
    let ownLabel: string | undefined;

    const onSubscribeFailed = (err: unknown) => {
      // Outside Tauri (web preview) there is no Finder open to route.
      if (!("__TAURI_INTERNALS__" in window)) return;
      loggingService.logEventSync({
        level: "error",
        event: LISTEN_LOG_EVENT,
        status: "fail",
        actionId: loggingService.generateActionId(),
        context: {
          eventName: OPEN_IN_WINDOW_EVENT,
          windowLabel: ownLabel,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    };

    let webview: ReturnType<typeof getCurrentWebviewWindow>;
    try {
      webview = getCurrentWebviewWindow();
      ownLabel = webview.label;
    } catch (err) {
      // Must not escape the effect: a throw here would unmount the React root.
      onSubscribeFailed(err);
      return;
    }

    const handle = (raw: unknown) => {
      const payload = parsePayload(raw);
      if (!payload) {
        logRoute("fail", { ownLabel }, "open-in-window payload was malformed");
        return;
      }
      const { windowLabel, documentId, path } = payload;
      if (windowLabel !== ownLabel) {
        logRoute("cancel", { outcome: "ignored-label", documentId, windowLabel, ownLabel });
        return;
      }
      // Read at event time: the subscription outlives every render.
      const exists = useDocumentStore.getState().documents.some((doc) => doc.id === documentId);
      if (exists) {
        // D92: a failed WYSIWYG flush refuses the switch; editorStore follows only a
        // switch that happened.
        if (!useDocumentStore.getState().setActiveDocumentId(documentId)) {
          logRoute("fail", { outcome: "focused-tab", documentId, windowLabel }, "flush-failed");
          return;
        }
        useEditorStore.getState().setActiveDocumentId(documentId);
        logRoute("success", { outcome: "focused-tab", documentId, windowLabel });
        return;
      }
      // The tab closed after Rust looked: open the path, and let ADR-0028 decide.
      void openRef.current(path).then(
        (opened) => {
          if (opened) logRoute("success", { outcome: "opened-path", documentId, windowLabel });
          else logRoute("fail", { outcome: "opened-path", documentId, windowLabel }, "open returned nothing");
        },
        (error: unknown) =>
          logRoute(
            "fail",
            { outcome: "opened-path", documentId, windowLabel },
            error instanceof Error ? error.message : String(error),
          ),
      );
    };

    webview
      .listen(OPEN_IN_WINDOW_EVENT, (event) => handle(event.payload))
      .then(
        (unlisten) => {
          if (cancelled) {
            unlisten();
            return;
          }
          dispose = unlisten;
          setRoutable(true);
        },
        onSubscribeFailed,
      );

    return () => {
      cancelled = true;
      dispose?.();
      dispose = null;
      // An unsubscribed window cannot hear a route, whatever the next mount does.
      setRoutable(false);
    };
  }, []);

  return { routable };
}
