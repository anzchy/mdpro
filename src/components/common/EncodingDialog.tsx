/**
 * Purpose: the prompt shown when an opened file is not valid UTF-8 and has no BOM.
 * It offers a checked UTF-16 retry (LE or BE) or Cancel (D52, ADR-0057).
 *
 * Key decisions:
 * - **No UTF-8 or ASCII button** (ADR-0057 decision 2): the dialog opens only when
 *   detection returned "unknown", which already ruled both out.
 * - **UTF-16 is a checked retry** (decision 3): Rust refuses an implausible decode
 *   (`encoding::hinted_decode_refusal`) and App shows the refusal toast.
 * - **Cancel is the initial focus; Escape and a backdrop click take Cancel**
 *   (decision 1), so Enter never commits a retry. Focus is one visible focus request
 *   (`useVisibleInitialFocus`, D53/D63), in the card, which mounts only while open.
 * - **Escape goes through the shared `useDialogEscape` stack** (D140, as ConfirmDialog
 *   since D34), dialog `"encoding"`, outcome `"cancel"`, calling the same `handleCancel`
 *   as the button and the backdrop, so App's `onCancel` aborts a pending retry (D121).
 *   The former backdrop `onKeyDown` only heard Escape while focus was inside the card; a
 *   click on the card's text (or on a button, which WebKit on macOS does not focus) left
 *   focus on `<body>` and Escape did nothing.
 * - **Tab is trapped in the card** (rule 32, D121) by an inline `onKeyDown` loop that
 *   mirrors `SettingsDialog.handleDialogKeyDown`: same focusable query, Tab wraps last
 *   to first, Shift+Tab first to last. Without it Tab left the dialog.
 * - Every string comes from `ENCODING_DIALOG_COPY`. The dialog takes no `detected`
 *   prop: the approved copy does not name a detected encoding.
 * - **A cancel gives focus back** (D317, B4: after Esc focus sat on the page root and a
 *   typed key edited nothing). The card mounts only while open, so each opening captures
 *   what held focus and the active document (`useReturnFocusOnClose`). Only a cancel
 *   returns: a retry that opened its document, or App clearing the issue, changes no
 *   focus. A saved non-editor control gets focus back; a saved editor surface is skipped,
 *   and the live view in the current mode is refocused through `view.focus()` (selection
 *   kept, `focusActiveEditor(…, "preserve")`) only while the document captured at open
 *   is still active and no other modal is open. That same path covers B4's open from
 *   `<body>`. Focus that moved outside the card is left alone.
 * - **One content-free line per cancel**, after the return:
 *   `ui.dialog.focus-return { controlId: "dialog.encoding.cancel", focus }`, where
 *   `focus` is where focus is now (`editor` / `other-control` / `none`), never a path
 *   or text, so a device run can tell the outcomes apart.
 *
 * @coordinates-with src/components/common/encodingDialogCopy.ts — the copy and options
 * @coordinates-with src/hooks/useVisibleInitialFocus.ts — the initial focus on Cancel
 * @coordinates-with src/hooks/useDialogEscape.ts — document-level capture-phase Escape stack
 * @coordinates-with src/hooks/useReturnFocusOnClose.ts — the focus return on cancel (D317)
 * @coordinates-with src/utils/focusActiveEditor.ts — the live editor, selection preserved (D317)
 * @coordinates-with tests/d52-encoding-dialog.test.tsx — ED-1 … ED-9
 * @coordinates-with tests/focus-trap.test.ts — FT-D121-1 … FT-D121-3
 * @coordinates-with tests/d140-dialog-escape-device-path.test.tsx — DP-1 … DP-6
 * @coordinates-with tests/d317-encoding-cancel-focus.test.tsx — D317-WI-1 … WI-3 (with -lifecycle, -focus-log)
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { useDialogEscape } from "../../hooks/useDialogEscape";
import { useReturnFocusOnClose } from "../../hooks/useReturnFocusOnClose";
import { useVisibleInitialFocus } from "../../hooks/useVisibleInitialFocus";
import { loggingService } from "../../services/loggingService";
import { useDocumentStore } from "../../stores/documentStore";
import { useEditorStore } from "../../stores/editorStore";
import { focusActiveEditor } from "../../utils/focusActiveEditor";
import { isModalOpen } from "../../utils/modalTabActionGuard";
import { ENCODING_DIALOG_COPY, ENCODING_DIALOG_OPTIONS } from "./encodingDialogCopy";

interface EncodingDialogProps {
  open: boolean;
  path: string;
  onSelect: (encoding: string) => void;
  onCancel: () => void;
}

const CANCEL_CONTROL_ID = "dialog.encoding.cancel";
/** This card, excluded when asking whether another modal is open. */
const CARD_SELECTOR = '[data-dialog="encoding"]';
const EDITOR_SELECTOR = ".ProseMirror, .cm-editor";

type FocusOutcome = "editor" | "other-control" | "none";

/** Where focus is now, as a log category (rule 20: no content). */
function focusOutcome(card: HTMLElement | null): FocusOutcome {
  const active = document.activeElement;
  if (!active || active === document.body || card?.contains(active)) return "none";
  return active.closest(EDITOR_SELECTOR) ? "editor" : "other-control";
}

export function EncodingDialog(props: EncodingDialogProps) {
  if (!props.open) return null;
  return <EncodingDialogCard {...props} />;
}

function EncodingDialogCard({ open, path, onSelect, onCancel }: EncodingDialogProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  // D317: the document this opening belongs to; a return never targets another one.
  const [openedFor] = useState(() => useDocumentStore.getState().activeDocumentId);

  const focusIntendedEditor = () => {
    const active = useDocumentStore.getState().activeDocumentId;
    if (!active || active !== openedFor || isModalOpen(CARD_SELECTOR)) return null;
    return focusActiveEditor(useEditorStore.getState().viewMode, "preserve");
  };
  useReturnFocusOnClose(backdropRef, focusIntendedEditor, {
    fromBody: true,
    shouldReturn: () => cancelled.current,
    acceptPrior: (el) => !el.closest(EDITOR_SELECTOR),
  });
  // Declared after the hook, so its cleanup runs after the hook's return.
  useLayoutEffect(() => {
    const card = backdropRef.current;
    return () => {
      if (!cancelled.current) return;
      loggingService.logUiEvent("ui.dialog.focus-return", {
        controlId: CANCEL_CONTROL_ID,
        focus: focusOutcome(card),
      });
    };
  }, []);

  const handleCancel = () => {
    loggingService.logDialogAction(CANCEL_CONTROL_ID, "cancel");
    cancelled.current = true;
    onCancel();
  };

  useDialogEscape({
    enabled: open,
    containerRef: backdropRef,
    dialog: "encoding",
    outcome: "cancel",
    onEscape: handleCancel,
  });

  useVisibleInitialFocus(cancelRef, open);

  // Focus trap: keep keyboard focus inside the dialog while it is open (rule 32)
  const handleDialogKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  return (
    <div
      ref={backdropRef}
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog-card"
        data-dialog="encoding"
        role="dialog"
        aria-modal="true"
        aria-label={ENCODING_DIALOG_COPY.ariaLabel}
        onKeyDown={handleDialogKeyDown}
      >
        <h3 className="dialog-title">{ENCODING_DIALOG_COPY.title}</h3>
        <p className="dialog-message">{ENCODING_DIALOG_COPY.body}</p>
        <p className="dialog-message">{ENCODING_DIALOG_COPY.retryHint}</p>
        <div className="encoding-path">{path}</div>
        <div className="encoding-options">
          {ENCODING_DIALOG_OPTIONS.map(({ encoding, label }) => (
            <button
              key={encoding}
              className="toolbar-button"
              type="button"
              onClick={() => {
                loggingService.logDialogAction("dialog.encoding.select", "success", {
                  encoding,
                });
                onSelect(encoding);
              }}
            >
              {label}
            </button>
          ))}
          <button ref={cancelRef} className="toolbar-button" type="button" onClick={handleCancel}>
            {ENCODING_DIALOG_COPY.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
