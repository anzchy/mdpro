/**
 * Purpose: decide what the single unsaved-changes `ConfirmDialog` in App.tsx is
 * currently about — a ⌘W document close, an OS window close, or a D16 app quit —
 * and which message it carries. Extracted (D16 WI-7) so App.tsx gains wiring
 * only: which of two pending prompts wins is a decision, and App.tsx is already
 * over 1100 lines.
 *
 * Key decisions:
 * - **A quit prompt always wins.** ADR-0025's phase 2 prompts one window at a
 *   time and the coordinator is holding `applicationShouldTerminate:` open while
 *   it waits. A close dialog left in front of it would strand the quit until the
 *   ack deadline, which ADR-0027 turns into a native alert. So `quitPrompt`
 *   takes the dialog over, and `clearsPendingClose` tells App.tsx to drop the
 *   close prompt it displaced rather than letting it reappear underneath.
 * - **Pure.** No store reads, no `requestId` arithmetic — the caller owns both
 *   inputs, so the whole domain is six rows and is enumerated in the test.
 *
 * @module src/utils/quitDialogModel
 * @coordinates-with src/App.tsx — renders the ConfirmDialog from this model
 * @coordinates-with src/hooks/useQuitGuard.ts — supplies `quitPrompt`
 * @coordinates-with src/hooks/useWindowCloseGuard.ts — supplies `"window"`
 */

/** What a non-quit close prompt is about. App.tsx raises `"document"` for ⌘W. */
export type QuitDialogPendingClose = "document" | "window" | null;

/** What the open dialog is about. `"quit"` outranks both close targets. */
export type QuitDialogTarget = "document" | "window" | "quit";

/** The phase-2 prompt this window is showing, if any. */
export interface QuitDialogPrompt {
  requestId: number;
}

export interface QuitDialogModel {
  /** The ConfirmDialog's `open`. */
  open: boolean;
  /** What a confirm/cancel applies to. `null` only when nothing is pending. */
  target: QuitDialogTarget | null;
  /** The ConfirmDialog's `message`. */
  message: string;
  /** The quit took a close prompt over: App.tsx must clear that pending close. */
  clearsPendingClose: boolean;
}

export const CLOSE_DIALOG_MESSAGE = "You have unsaved changes. Close without saving?";
export const QUIT_DIALOG_MESSAGE = "Quit without saving?";

/**
 * The priority rule, whole: the dialog is open iff either prompt is pending, and
 * a pending quit names the target whatever the close prompt says.
 */
export function quitDialogModel(inputs: {
  pendingClose: QuitDialogPendingClose;
  quitPrompt: QuitDialogPrompt | null;
}): QuitDialogModel {
  const { pendingClose, quitPrompt } = inputs;
  const target: QuitDialogTarget | null = quitPrompt ? "quit" : pendingClose;
  return {
    open: pendingClose !== null || quitPrompt !== null,
    target,
    message: target === "quit" ? QUIT_DIALOG_MESSAGE : CLOSE_DIALOG_MESSAGE,
    clearsPendingClose: target === "quit",
  };
}
