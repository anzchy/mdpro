/**
 * Purpose: decides when this window's startup Recovery dialog may show, and
 * with which rows (D241, ADR-0116 Decisions 1, 3 and 4). Recovery waits while
 * another modal is open or a received MCP request is still live, re-lists the
 * drafts once nothing holds it, and is admitted only if nothing holds it when
 * that fresh list returns.
 *
 * Pipeline: App's startup `drafts` → check (every AppDialogs commit, every
 * `aria-modal` change, every MCP-pending flip) → held (`ui.recovery.held`) or
 * `invoke("list_drafts")` → final check → admitted (`ui.recovery.released`,
 * the MCP slot latched) → `rows` → slot cleared once no row is left.
 *
 * Key decisions:
 * - **The MCP-pending flag is a ref** that `useMcpConfirm` writes in its event
 *   handlers, before React renders. Its `onPendingChange` only bumps a counter
 *   here to schedule a re-check; the check reads the ref.
 * - **The check runs in a layout effect**, so it sees a modal that opened in
 *   the same commit as the drafts, and a MutationObserver re-checks when a
 *   modal outside AppDialogs closes.
 * - **One re-list at a time**, with a sequence number and a mounted guard, so
 *   a superseded or unmounted re-list sets nothing. The rows are the re-list's,
 *   limited to drafts App still offers; a failed re-list falls back to App's
 *   drafts. An empty re-list settles: no Recovery and no further re-list.
 * - **Admitted never clears** for the window's life, so a modal opened over
 *   Recovery never holds it again. **The slot** (`link.recoverySlot`) is set
 *   with admission, before React renders, so an MCP request cannot mount in
 *   the gap before Recovery's commit; it clears, followed by a republish,
 *   when no row is left and on unmount.
 *
 * @module hooks/useRecoveryAdmission
 * @coordinates-with src/components/AppDialogs.tsx — the caller; renders `rows`
 * @coordinates-with src/hooks/mcpRecoveryLink.ts — the link shared with `useMcpConfirm`
 * @coordinates-with src/utils/modalTabActionGuard.ts — `isModalOpen`
 */
import { invoke } from "@tauri-apps/api/core";
import { useLayoutEffect, useRef, useState } from "react";
import type { DraftMetadata } from "../services/draftService";
import { loggingService } from "../services/loggingService";
import { isModalOpen } from "../utils/modalTabActionGuard";
import { createMcpRecoveryLink, type McpRecoveryLink } from "./mcpRecoveryLink";

type HoldReason = "modal" | "mcp";

export interface RecoveryAdmission {
  /** The admitted rows App still offers; empty until admission. */
  rows: DraftMetadata[];
  /** Pass to `McpWriteConfirm` so the MCP queue and Recovery see each other. */
  mcpLink: McpRecoveryLink;
}

export function useRecoveryAdmission(drafts: DraftMetadata[]): RecoveryAdmission {
  const [, bump] = useState(0);
  const [link] = useState(() => {
    const created = createMcpRecoveryLink();
    created.onPendingChange = () => bump((n) => n + 1);
    return created;
  });
  const [admitted, setAdmitted] = useState<DraftMetadata[] | null>(null);
  const draftsRef = useRef(drafts);
  const state = useRef({ admitted: false, settled: false, inFlight: false, heldLogged: false, seq: 0, mounted: false });

  const holdReason = (): HoldReason | null => {
    if (link.pending.current) return "mcp";
    return isModalOpen() ? "modal" : null;
  };

  const logHeld = (reason: HoldReason) => {
    if (state.current.heldLogged) return;
    state.current.heldLogged = true;
    loggingService.logUiEvent("ui.recovery.held", { reason, count: draftsRef.current.length });
  };

  /** `found` is the re-list, or anything else when it failed (fall back to App's drafts). */
  const finish = (seq: number, found: unknown) => {
    const s = state.current;
    if (!s.mounted || seq !== s.seq) return;
    s.inFlight = false;
    const offered = new Set(draftsRef.current.map((d) => d.id));
    const fresh = Array.isArray(found) ? (found as DraftMetadata[]).filter((d) => offered.has(d.id)) : draftsRef.current;
    if (fresh.length === 0) {
      s.settled = true;
      return;
    }
    const reason = holdReason();
    if (reason) {
      logHeld(reason);
      return;
    }
    s.admitted = true;
    link.recoverySlot.current = true;
    setAdmitted(fresh);
    loggingService.logUiEvent("ui.recovery.released", { count: fresh.length });
  };

  const check = () => {
    const s = state.current;
    if (!s.mounted || s.admitted || s.settled || s.inFlight || draftsRef.current.length === 0) return;
    const reason = holdReason();
    if (reason) {
      logHeld(reason);
      return;
    }
    s.inFlight = true;
    s.heldLogged = false;
    s.seq += 1;
    const seq = s.seq;
    invoke<unknown>("list_drafts", {}).then(
      (found) => finish(seq, found),
      () => finish(seq, null),
    );
  };
  const checkRef = useRef(check);

  const offered = new Set(drafts.map((d) => d.id));
  const rows = admitted ? admitted.filter((d) => offered.has(d.id)) : [];

  // Declared first: layout effects run in order, so the per-commit check
  // below already sees `mounted` on the first commit.
  useLayoutEffect(() => {
    const s = state.current;
    s.mounted = true;
    const observer = new MutationObserver(() => checkRef.current());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-modal"],
    });
    return () => {
      s.mounted = false;
      s.inFlight = false;
      s.seq += 1;
      observer.disconnect();
      if (link.recoverySlot.current) {
        link.recoverySlot.current = false;
        link.republish.current?.();
      }
    };
  }, [link]);

  useLayoutEffect(() => {
    draftsRef.current = drafts;
    checkRef.current = check;
    check();
    if (admitted !== null && rows.length === 0 && link.recoverySlot.current) {
      link.recoverySlot.current = false;
      link.republish.current?.();
    }
  });

  return { rows, mcpLink: link };
}
