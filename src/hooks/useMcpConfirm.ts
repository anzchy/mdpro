/**
 * Purpose: the webview half of the ADR-0042 in-window MCP write confirmation.
 * Rust holds an MCP write open while it asks the owning window to confirm it;
 * this hook keeps that window's prompts, shows one at a time, and sends the
 * user's answer back. One instance per window.
 *
 * Pipeline: `mcp:confirm_request` → `confirmRequestOf` → FIFO queue (dedup by
 * `requestId`) → `prompt` is the head · `approve` / `reject` → drop the head →
 * `mcp_confirm_reply` (fire-and-forget) · `mcp:confirm_resolved` →
 * `confirmResolvedOf` → drop that id wherever it is queued; if it was the head,
 * the next prompt shows. A resolved event never sends a reply.
 *
 * Key decisions:
 * - **Per-webview `listen`, never the global one.** Rust targets the owning
 *   window with `emit_to`; only a window-scoped listener honours that target, so
 *   a global `listen` would show every prompt in every window.
 * - **Queue and latch live in refs** (rule 50 §1). The listeners are installed
 *   once, and the actions must see the queue as it is now, not as a render
 *   closure captured it.
 * - **An action answers only the prompt the user is looking at.** `shownRef`
 *   holds the prompt last committed to the screen; an action applies only when
 *   it is still the head. So two clicks before a re-render answer once and do
 *   not answer the next prompt the user never saw (HK-4), and a click that loses
 *   the race with a `confirm_resolved` sends nothing (HK-11).
 * - **Every id is seen once.** A repeated request, or a request for an id that
 *   was already answered or resolved, is ignored: at most one reply per id.
 * - **A failed reply still advances.** The prompt is dropped before the IPC;
 *   `mcpConfirmService` logs the failure, the catch keeps it from being an
 *   unhandled rejection, and Rust's timeout ends the request anyway.
 * - **Subscribe with a `cancelled` flag and `Promise.allSettled`** (the
 *   `useQuitGuard` pattern): a teardown that beats `listen` unlistens the late
 *   registration, and under Tauri any failed subscription logs one
 *   `mcp.confirm.listen` fail with counts only.
 * - **Logs carry the request id and operation only** — never the document title,
 *   its id, or content. A malformed payload logs `{ reason: "malformed" }`.
 *
 * @module src/hooks/useMcpConfirm
 * @coordinates-with src-tauri/src/services/mcp_confirm/ — emits the two events
 * @coordinates-with src/services/mcpConfirmService.ts — the `mcp_confirm_reply` IPC
 * @coordinates-with src/utils/mcpConfirmModel.ts — payload guards and types
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { loggingService } from "../services/loggingService";
import { mcpConfirmService } from "../services/mcpConfirmService";
import {
  confirmRequestOf,
  confirmResolvedOf,
  type ConfirmRequest,
  type ConfirmResolved,
} from "../utils/mcpConfirmModel";

/** The two events `services/mcp_confirm` emits to the owning window. */
export const MCP_CONFIRM_REQUEST_EVENT = "mcp:confirm_request";
export const MCP_CONFIRM_RESOLVED_EVENT = "mcp:confirm_resolved";

export interface McpConfirm {
  /** The confirmation this window is showing, or `null`. */
  prompt: ConfirmRequest | null;
  /** The user approved the shown write: reply `approved: true`. */
  approve: () => void;
  /** The user rejected the shown write: reply `approved: false`. */
  reject: () => void;
}

function logMalformed(event: string): void {
  loggingService.logEventSync({
    level: "warn",
    event,
    status: "fail",
    actionId: loggingService.generateActionId(),
    context: { reason: "malformed" },
  });
}

export function useMcpConfirm(): McpConfirm {
  const [prompt, setPrompt] = useState<ConfirmRequest | null>(null);
  const queueRef = useRef<ConfirmRequest[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  // The prompt last committed to the screen: what the user can be answering.
  const shownRef = useRef<ConfirmRequest | null>(null);

  useLayoutEffect(() => {
    shownRef.current = prompt;
  }, [prompt]);

  const publish = useCallback(() => {
    setPrompt(queueRef.current[0] ?? null);
  }, []);

  const handleRequest = useCallback(
    (req: ConfirmRequest) => {
      if (seenRef.current.has(req.requestId)) return;
      seenRef.current.add(req.requestId);
      queueRef.current = [...queueRef.current, req];
      if (queueRef.current.length === 1) publish();
    },
    [publish],
  );

  const handleResolved = useCallback(
    ({ requestId }: ConfirmResolved) => {
      seenRef.current.add(requestId);
      const queue = queueRef.current;
      const index = queue.findIndex((req) => req.requestId === requestId);
      if (index < 0) return;
      queueRef.current = queue.filter((_, i) => i !== index);
      if (index === 0) publish();
    },
    [publish],
  );

  const answer = useCallback(
    (approved: boolean) => {
      const shown = shownRef.current;
      const head = queueRef.current[0];
      if (!shown || !head || head.requestId !== shown.requestId) return;
      queueRef.current = queueRef.current.slice(1);
      publish();
      const { requestId, operation } = head;
      loggingService.logUiEvent(
        approved ? "ui.mcp_confirm.approve" : "ui.mcp_confirm.reject",
        { requestId, operation },
      );
      // The service has already logged `mcp.confirm.reply`; swallow here so a
      // lost reply is not an unhandled rejection. Rust's timeout ends it.
      void mcpConfirmService.reply(requestId, approved).catch(() => {});
    },
    [publish],
  );

  const approve = useCallback(() => answer(true), [answer]);
  const reject = useCallback(() => answer(false), [answer]);

  useEffect(() => {
    // `listen` resolves after an await, so a teardown can beat it; the flag
    // makes the late registration unlisten itself instead of leaking.
    let cancelled = false;
    const disposers: UnlistenFn[] = [];

    const subscribe = async <T>(
      name: string,
      logEvent: string,
      parse: (payload: unknown) => T | null,
      handler: (value: T) => void,
    ) => {
      const dispose = await getCurrentWebviewWindow().listen(name, (message) => {
        const value = parse(message.payload);
        if (value === null) {
          logMalformed(logEvent);
          return;
        }
        handler(value);
      });
      if (cancelled) {
        dispose();
        return;
      }
      disposers.push(dispose);
    };

    void (async () => {
      const results = await Promise.allSettled([
        subscribe(MCP_CONFIRM_REQUEST_EVENT, "mcp.confirm.request", confirmRequestOf, handleRequest),
        subscribe(MCP_CONFIRM_RESOLVED_EVENT, "mcp.confirm.resolved", confirmResolvedOf, handleResolved),
      ]);
      const failedCount = results.filter((r) => r.status === "rejected").length;
      // Outside Tauri (web preview) there is no MCP server, so no failure.
      if (failedCount === 0 || !("__TAURI_INTERNALS__" in window)) return;
      loggingService.logEventSync({
        level: "error",
        event: "mcp.confirm.listen",
        status: "fail",
        actionId: loggingService.generateActionId(),
        // Counts only: the rejection reasons are never logged.
        context: { subscribedCount: results.length - failedCount, failedCount },
      });
    })();

    return () => {
      cancelled = true;
      for (const dispose of disposers) dispose();
      disposers.length = 0;
    };
  }, [handleRequest, handleResolved]);

  return { prompt, approve, reject };
}
