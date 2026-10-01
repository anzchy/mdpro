/**
 * Purpose: one shared Escape stack for modal dialogs (D34). Escape dismisses the topmost
 * registered dialog wherever focus is — `<body>`, the editor, an outside input, or inside
 * the card — because the listener sits on `document` in the capture phase instead of on
 * the dialog's own element, where it only fired while focus was inside the card.
 *
 * Pipeline: a dialog mounts with `enabled` → its entry joins the module registry (the first
 * entry attaches one `document` keydown capture listener) · keydown → ignore non-Escape and
 * IME (`isComposing` / `keyCode 229`) without consuming · pick the attached registered
 * container last in document order (none → not consumed) · if an unregistered open modal
 * (`[aria-modal="true"]` outside every registered container) follows it in the document, do
 * nothing at all · else `preventDefault` + `stopPropagation` · a `repeat` Escape stops there ·
 * otherwise call that entry's latest `onEscape` and log `ui.dialog.escape {dialog, outcome}`
 * (a throw logs `{dialog, outcome: "error"}` at level error / status fail, then rethrows)
 * · the dialog unmounts or disables → its entry leaves (the last one detaches the listener).
 *
 * Key decisions:
 * - **Topmost = last in DOM order** (`compareDocumentPosition`), ties to the later
 *   registration (D34 user decision, 2026-10-01). Open order is wrong: `App.tsx` renders the MCP
 *   prompt after `ConfirmDialog` at the same z-index, so it paints on top either way.
 * - **Yield to a later unregistered modal** (D34 WI-6, review C-1, user decision): `App.tsx`
 *   renders Reload / Recovery / Encoding / Settings after the BottomTabs and Sidebar
 *   `ConfirmDialog`s, unregistered. When one of them is open later in the DOM than the
 *   topmost registered dialog, the event is left untouched (no consume, no `onEscape`, no
 *   log) so the visible dialog's own `onKeyDown` can take it — which still needs focus inside
 *   it. An `aria-modal` inside a registered container (its own card) does not count, and an
 *   unregistered modal earlier in the DOM, or one containing the registered dialog, does not
 *   block it.
 * - **Unattached entries are never topmost** (C-3): an entry whose `containerRef` is null is
 *   skipped; with only such entries Escape is not consumed.
 * - **Registry keyed by registration identity**, never by `dialog` name — four
 *   `ConfirmDialog` instances all register `"confirm"`.
 * - **Repeat is consumed but dismisses nothing**: holding Esc must not reject queued MCP
 *   prompts the user never saw.
 * - **No contenteditable skip**: while a dialog is open the editor does not get Escape.
 * - **`onEscape` read through a ref** at dispatch time, so a re-render never leaves a
 *   stale closure; a throwing `onEscape` logs a failure line (never the success outcome,
 *   never the error text) and leaves the registry intact; a dialog whose handler always
 *   throws stays topmost, so it keeps taking Escape until it closes.
 *
 * @coordinates-with src/services/loggingService.ts — `logUiEvent("ui.dialog.escape")`
 * @coordinates-with tests/use-dialog-escape.test.tsx — DE-1 … DE-28
 * @coordinates-with tests/mcp-confirm-escape-stack.test.tsx — ES-5 … ES-7 (yield, real ReloadDialog)
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { loggingService } from "../services/loggingService";

export interface DialogEscapeOptions {
  /** Register while true (typically the dialog's `open`). */
  enabled: boolean;
  /** The dialog's outermost element; its document position decides who is topmost. */
  containerRef: RefObject<HTMLElement | null>;
  /** Log-only identifier, e.g. `"confirm"`. Not an identity: names may repeat. */
  dialog: string;
  /** Log-only outcome of an Escape for this dialog, e.g. `"cancel"` / `"reject"`. */
  outcome: string;
  /** Called once per qualifying Escape while this dialog is topmost. */
  onEscape: () => void;
}

interface Latest {
  dialog: string;
  outcome: string;
  onEscape: () => void;
}

interface Entry {
  containerRef: RefObject<HTMLElement | null>;
  latest: RefObject<Latest>;
}

const ESCAPE_EVENT = "ui.dialog.escape";
/** `keyCode` browsers report for a keydown that belongs to an IME composition. */
const IME_KEY_CODE = 229;
/**
 * An open modal that may not be on the stack. Every unregistered app modal (Reload,
 * Recovery, Encoding, Settings, LinkInsertModal, TableInsertModal) renders its card with
 * `aria-modal="true"` only while open.
 */
const MODAL_SELECTOR = '[aria-modal="true"]';
/** Logged `outcome` when the topmost dialog's `onEscape` throws. */
const FAILED_OUTCOME = "error";

/** Registration order; a re-registration appends a new entry. */
const registry: Entry[] = [];

function follows(reference: Node, other: Node): boolean {
  return (reference.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * The entry whose container is last in document order; ties go to the later registration.
 * Entries whose `containerRef` is not attached are never chosen (C-3): a dialog with no
 * element on screen cannot be the one the user is looking at.
 */
function topmost(): { entry: Entry; element: HTMLElement } | undefined {
  let top: { entry: Entry; element: HTMLElement } | undefined;
  for (const entry of registry) {
    const element = entry.containerRef.current;
    if (!element) continue;
    if (!top || element === top.element || follows(top.element, element)) top = { entry, element };
  }
  return top;
}

/**
 * True when an open modal that is not inside any registered container sits later in the
 * document than `top` — it paints above every registered dialog, so Escape is its to handle.
 */
function yieldsToUnregisteredModal(top: HTMLElement): boolean {
  for (const modal of document.querySelectorAll(MODAL_SELECTOR)) {
    if (registry.some((entry) => entry.containerRef.current?.contains(modal))) continue;
    if (follows(top, modal)) return true;
  }
  return false;
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (event.isComposing || event.keyCode === IME_KEY_CODE) return;
  const top = topmost();
  if (!top || yieldsToUnregisteredModal(top.element)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return;
  const { dialog, outcome, onEscape } = top.entry.latest.current;
  try {
    onEscape();
  } catch (error) {
    loggingService.logUiEvent(ESCAPE_EVENT, { dialog, outcome: FAILED_OUTCOME }, "error", "fail");
    throw error;
  }
  loggingService.logUiEvent(ESCAPE_EVENT, { dialog, outcome });
}

function register(entry: Entry): () => void {
  registry.push(entry);
  if (registry.length === 1) document.addEventListener("keydown", handleKeyDown, true);
  return () => {
    const index = registry.indexOf(entry);
    if (index === -1) return;
    registry.splice(index, 1);
    if (registry.length === 0) document.removeEventListener("keydown", handleKeyDown, true);
  };
}

/**
 * Put this dialog on the shared Escape stack while `enabled`. Call it before any early
 * `return null` (rules of hooks); `containerRef` must be attached to the dialog's
 * outermost element whenever `enabled` is true.
 */
export function useDialogEscape({ enabled, containerRef, dialog, outcome, onEscape }: DialogEscapeOptions): void {
  const latest = useRef<Latest>({ dialog, outcome, onEscape });

  useLayoutEffect(() => {
    latest.current = { dialog, outcome, onEscape };
  });

  useLayoutEffect(() => {
    if (!enabled) return;
    return register({ containerRef, latest });
  }, [enabled, containerRef]);
}
