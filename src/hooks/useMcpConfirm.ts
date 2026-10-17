/**
 * Purpose: the webview half of the ADR-0042 in-window MCP write confirmation.
 * Rust holds an MCP write open while it asks the owning window to confirm it;
 * this hook keeps that window's prompts, shows one at a time, and sends the
 * user's answer back. One instance per window.
 *
 * Pipeline: `mcp:confirm_request` → `confirmRequestOf` → FIFO queue (dedup by
 * `requestId`, deadline = arrival + `expiresInMs`) → `prompt` is the head, unless
 * another modal is open (then `null`, the head waits) · `approve` / `reject` →
 * drop the head → `mcp_confirm_reply` (fire-and-forget) · `mcp:confirm_resolved`
 * → `confirmResolvedOf` → drop that id wherever it is queued; if it was the head,
 * the next prompt shows · the last other modal closes (a `MutationObserver`) →
 * the oldest request still live shows. A resolved event never sends a reply.
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
 * - **A prompt waits while another modal is open** (D240, ADR-0108). It mounted on
 *   top of Insert Link or Settings and took focus, so the next Enter or Escape
 *   meant for that dialog rejected an unrelated write. While any `[aria-modal]`
 *   other than this prompt's own card is in the document, a head that is not
 *   already shown renders nothing, takes no focus and registers no Escape. A
 *   prompt already on screen stays when a dialog opens over it (ADR-0062).
 * - **Rust's deadline, never restarted.** A held request keeps arrival +
 *   `expiresInMs`. A timer at the earliest deadline drops it without a reply
 *   (ADR-0116), so Rust's own timeout (408) ends it: never a reject, never an
 *   approve. Rust's `confirm_resolved` usually drops it first.
 * - **Startup Recovery waits for it** (D241, ADR-0116), through the optional
 *   `McpRecoveryLink`; while its `recoverySlot` is set, a head waits as behind a modal.
 * - **Logs carry the request id and operation only** — never the document title,
 *   its id, or content. A malformed payload logs `{ reason: "malformed" }`.
 *
 * @module src/hooks/useMcpConfirm
 * @coordinates-with src-tauri/src/services/mcp_confirm/ — emits the two events
 * @coordinates-with src/services/mcpConfirmService.ts — the `mcp_confirm_reply` IPC
 * @coordinates-with src/utils/mcpConfirmModel.ts — payload guards and types
 * @coordinates-with src/utils/modalTabActionGuard.ts — `isModalOpen`, what holds a prompt
 * @coordinates-with src/hooks/mcpRecoveryLink.ts — the D241 link to startup Recovery
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { loggingService } from "../services/loggingService";
import { mcpConfirmService } from "../services/mcpConfirmService";
import { isModalOpen } from "../utils/modalTabActionGuard";
import {
  confirmRequestOf,
  confirmResolvedOf,
  type ConfirmRequest,
  type ConfirmResolved,
} from "../utils/mcpConfirmModel";
import type { McpRecoveryLink } from "./mcpRecoveryLink";

export { createMcpRecoveryLink, type McpRecoveryLink } from "./mcpRecoveryLink";

/** The two events `services/mcp_confirm` emits to the owning window. */
export const MCP_CONFIRM_REQUEST_EVENT = "mcp:confirm_request";
export const MCP_CONFIRM_RESOLVED_EVENT = "mcp:confirm_resolved";

/** This prompt's own card (`McpWriteConfirmDialog`), which never holds the queue. */
const OWN_CARD_SELECTOR = ".mcp-confirm-dialog";

export interface McpConfirm {
  /** The confirmation this window is showing, or `null`. */
  prompt: ConfirmRequest | null;
  /** The user approved the shown write: reply `approved: true`. */
  approve: () => void;
  /** The user rejected the shown write: reply `approved: false`. */
  reject: () => void;
}

function logHeld(event: string, { requestId, operation }: ConfirmRequest): void {
  loggingService.logEventSync({
    level: "info",
    event,
    status: "cancel",
    actionId: loggingService.generateActionId(),
    context: { requestId, operation },
  });
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

export function useMcpConfirm(link?: McpRecoveryLink): McpConfirm {
  const [prompt, setPrompt] = useState<ConfirmRequest | null>(null);
  const queueRef = useRef<ConfirmRequest[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  // Rust's deadline per queued id (arrival + expiresInMs), never restarted.
  const deadlineRef = useRef<Map<string, number>>(new Map());
  // Ids already logged as held behind another modal: one line each.
  const heldRef = useRef<Set<string>>(new Set());
  // The prompt last committed to the screen: what the user can be answering.
  const shownRef = useRef<ConfirmRequest | null>(null);

  const linkRef = useRef(link);
  linkRef.current = link;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    shownRef.current = prompt;
  }, [prompt]);

  // Every queue change goes through here: the pending flag and the deadline timer follow it.
  const setQueue = useCallback((next: ConfirmRequest[]) => {
    queueRef.current = next;
    const current = linkRef.current;
    if (current && current.pending.current !== next.length > 0) {
      current.pending.current = next.length > 0;
      current.onPendingChange?.();
    }
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const earliest = Math.min(...next.map((req) => deadlineRef.current.get(req.requestId) ?? Infinity));
    const wait = Math.max(0, earliest - Date.now());
    timerRef.current = earliest === Infinity ? null : setTimeout(() => publishRef.current(), wait);
  }, []);

  // A request leaving the queue drops its deadline and held mark with it.
  const forget = useCallback((requestId: string) => {
    deadlineRef.current.delete(requestId);
    heldRef.current.delete(requestId);
  }, []);

  const publish = useCallback(() => {
    const now = Date.now();
    const live = queueRef.current.filter((req) => (deadlineRef.current.get(req.requestId) ?? now + 1) > now);
    for (const req of queueRef.current) {
      if (live.includes(req)) continue;
      logHeld("ui.mcp_confirm.expired", req);
      forget(req.requestId);
    }
    setQueue(live);
    const head = live[0] ?? null;
    const held = isModalOpen(OWN_CARD_SELECTOR) || Boolean(linkRef.current?.recoverySlot.current);
    if (head && head.requestId !== shownRef.current?.requestId && held) {
      if (!heldRef.current.has(head.requestId)) {
        heldRef.current.add(head.requestId);
        logHeld("ui.mcp_confirm.held", head);
      }
      setPrompt(null);
      return;
    }
    setPrompt(head);
  }, [forget, setQueue]);
  publishRef.current = publish;

  useEffect(() => {
    const current = link;
    if (current) current.republish.current = publish;
    return () => {
      if (current) current.republish.current = null;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [link, publish]);

  const handleRequest = useCallback(
    (req: ConfirmRequest) => {
      if (seenRef.current.has(req.requestId)) return;
      seenRef.current.add(req.requestId);
      deadlineRef.current.set(req.requestId, Date.now() + req.expiresInMs);
      setQueue([...queueRef.current, req]);
      if (queueRef.current.length === 1) publish();
    },
    [publish, setQueue],
  );

  const handleResolved = useCallback(
    ({ requestId }: ConfirmResolved) => {
      seenRef.current.add(requestId);
      const queue = queueRef.current;
      const index = queue.findIndex((req) => req.requestId === requestId);
      if (index < 0) return;
      forget(requestId);
      setQueue(queue.filter((_, i) => i !== index));
      if (index === 0) publish();
    },
    [forget, publish, setQueue],
  );

  const answer = useCallback(
    (approved: boolean) => {
      const shown = shownRef.current;
      const head = queueRef.current[0];
      if (!shown || !head || head.requestId !== shown.requestId) return;
      forget(head.requestId);
      setQueue(queueRef.current.slice(1));
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
    [forget, publish, setQueue],
  );

  const approve = useCallback(() => answer(true), [answer]);
  const reject = useCallback(() => answer(false), [answer]);

  // The last other modal closing is a DOM change: re-publish then, so the oldest
  // live request shows. Cheap when there is nothing waiting.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (queueRef.current.length === 0 || shownRef.current) return;
      publish();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-modal"],
    });
    return () => observer.disconnect();
  }, [publish]);

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
