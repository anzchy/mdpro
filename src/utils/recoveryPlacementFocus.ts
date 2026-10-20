/**
 * Purpose: hold Recovery's focus return until the draft has a committed editor
 * destination. The dialog may close while get_draft or recover_draft is pending;
 * neither wait may return focus to the outgoing document.
 *
 * Key decisions:
 * - The guard starts on the Recover click, before the first IPC await.
 * - A document switch, outside focus, or another modal cancels the return once.
 *   Only an actual active-ID transition counts as a switch; unrelated store
 *   writes during overlapping placements do not cancel a valid return.
 * - Placement activation is identified before the store write, so its own
 *   A→destination transition is not mistaken for a user switch.
 * - A claimed draft's placement failure cancels focus; it does not offer a
 *   retry because the Rust ownership guard refuses the same claim again.
 *
 * @module utils/recoveryPlacementFocus
 * @coordinates-with src/components/common/RecoveryDialog.tsx
 * @coordinates-with src/utils/recoverIntoOpenTab.ts
 * @coordinates-with src/utils/focusActiveEditor.ts
 */
import { useSyncExternalStore } from "react";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import { isModalOpen } from "./modalTabActionGuard";
import { requestActiveEditorFocus } from "./focusActiveEditor";

type CancelReason = "moved" | "modal" | "switched" | "placement" | "activation";
interface Token { placementStarted: boolean }

const tokens = new Map<string, Token>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();
let observedActiveId: string | null = null;
let internalDestination: string | null = null;
let insideRecoverCallback = false;
let completedDestination: string | null = null;
let canceled: CancelReason | null = null;
let returnOwed = false;
let releaseWatchers: (() => void) | null = null;

function publish(): void {
  snapshot = new Set(tokens.keys());
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Read pending row IDs reactively without disabling keyboard focus on buttons. */
export function useRecoveryPendingIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** A newly mounted Recovery card must not inherit the last card's cancellation. */
export function recoveryCardOpened(): void {
  if (tokens.size > 0) return;
  completedDestination = null;
  canceled = null;
  returnOwed = false;
}

function cancel(reason: CancelReason): void {
  if (canceled) return;
  canceled = reason;
  loggingService.logEventSync({
    level: "info", event: "ui.recovery.focus.cancel", status: "cancel",
    actionId: loggingService.generateActionId(), context: { reason },
  });
}

function watch(): void {
  const onFocus = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || target === document.body || target.closest(".recovery-dialog")) return;
    cancel(isModalOpen(".recovery-dialog") ? "modal" : "moved");
  };
  const unlisten = useDocumentStore.subscribe((state) => {
    if (state.activeDocumentId === observedActiveId) return;
    observedActiveId = state.activeDocumentId;
    if (insideRecoverCallback) { completedDestination = state.activeDocumentId; return; }
    if (internalDestination && state.activeDocumentId === internalDestination) return;
    cancel("switched");
  });
  const observer = new MutationObserver(() => { if (isModalOpen(".recovery-dialog")) cancel("modal"); });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("focusin", onFocus, true);
  releaseWatchers = () => {
    unlisten(); observer.disconnect(); document.removeEventListener("focusin", onFocus, true);
  };
}

function finishReturn(): void {
  if (!returnOwed || tokens.size > 0) return;
  returnOwed = false;
  if (canceled) { completedDestination = null; return; }
  const destination = completedDestination;
  completedDestination = null;
  if (destination && useDocumentStore.getState().activeDocumentId !== destination) {
    cancel("activation");
    return;
  }
  requestActiveEditorFocus("ui.recovery.focus.cancel");
}

function remove(id: string): void {
  if (!tokens.delete(id)) return;
  publish();
  if (tokens.size === 0) {
    releaseWatchers?.(); releaseWatchers = null;
    finishReturn();
  }
}

/** Begin guarding before `recover_draft`'s await; false for a duplicate click. */
export function beginRecoveryFocus(id: string): boolean {
  if (tokens.has(id)) return false;
  if (tokens.size === 0) {
    observedActiveId = useDocumentStore.getState().activeDocumentId;
    completedDestination = null; canceled = null; returnOwed = false;
    watch();
  }
  tokens.set(id, { placementStarted: false });
  publish();
  return true;
}

/** Preserve a synchronous Recover callback's own activation (older callers). */
export function runRecoveryCallback<T>(callback: () => T): T {
  insideRecoverCallback = true;
  try { return callback(); } finally { insideRecoverCallback = false; }
}

/** `recover_draft` settled without starting placement (gone/error). */
export function settleRecoverAction(id: string): void {
  if (tokens.get(id)?.placementStarted === false) remove(id);
}

/** Called synchronously when real placement begins, before its first await. */
export function recoveryPlacementStarted(id: string): void {
  const token = tokens.get(id);
  if (token) token.placementStarted = true;
}

/** Suppress switch cancellation for this placement's own activation. */
export function recoveryWillActivate(id: string, destinationId: string): void {
  if (tokens.has(id)) internalDestination = destinationId;
}

/** Commit the focus destination only when it actually became active. */
export function recoveryPlacementCommitted(id: string, destinationId: string): void {
  if (!tokens.has(id)) return;
  internalDestination = null;
  if (useDocumentStore.getState().activeDocumentId !== destinationId) cancel("activation");
  else completedDestination = destinationId;
  remove(id);
}

/** A post-claim placement throw cannot offer another Recover; suppress focus. */
export function recoveryPlacementFailed(id: string): void {
  if (!tokens.has(id)) return;
  internalDestination = null;
  cancel("placement");
  remove(id);
}

/** Recovery's opt-in fallback: no target is returned while placement is pending. */
export function returnFocusAfterRecoveryClose(): HTMLElement | null {
  if (tokens.size > 0) { returnOwed = true; return null; }
  if (canceled) { completedDestination = null; return null; }
  const destination = completedDestination;
  completedDestination = null;
  if (destination && useDocumentStore.getState().activeDocumentId !== destination) {
    cancel("activation"); return null;
  }
  return requestActiveEditorFocus("ui.recovery.focus.cancel");
}
