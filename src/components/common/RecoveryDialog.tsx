/**
 * RecoveryDialog Component
 *
 * Purpose: the startup "Recover drafts" dialog — one row per admitted draft,
 * each with Recover and Discard. Renders nothing without rows; the card is
 * mounted only while there are rows, so its focus handling (D273, ADR-0116
 * Decision 5) starts at the first commit that shows a row.
 *
 * Key decisions:
 * - **Return target captured at the first populated commit** by
 *   `useReturnFocusOnClose`; when the last row goes, focus returns there, or
 *   to the active editor at its end if that element is gone.
 * - **Visible initial focus on the first row's Recover** (rule 33), unless
 *   another modal is already open when the card first renders.
 * - **Tab and Shift+Tab loop inside the card** (rule 32). No Escape and no
 *   backdrop close: every draft needs an explicit Recover or Discard.
 * - **Focus never falls to `<body>` while Recovery is the top dialog**: a
 *   removed row hands focus to the Recover now at its place (the next row),
 *   or the previous row's after the last; a modal closed over Recovery hands
 *   focus back to the control that last had it.
 *
 * @module components/common/RecoveryDialog
 * @coordinates-with src/components/AppDialogs.tsx — passes the admitted rows (D241)
 * @coordinates-with src/hooks/useReturnFocusOnClose.ts — the return on close
 * @coordinates-with src/utils/focusActiveMilkdownAtEnd.ts — the editor fallback
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useReturnFocusOnClose } from "../../hooks/useReturnFocusOnClose";
import { useVisibleInitialFocus } from "../../hooks/useVisibleInitialFocus";
import type { DraftMetadata } from "../../services/draftService";
import { loggingService } from "../../services/loggingService";
import { focusActiveMilkdownAtEnd } from "../../utils/focusActiveMilkdownAtEnd";
import { isModalOpen } from "../../utils/modalTabActionGuard";
import { draftTimeLabel } from "../../utils/platformLabels";

interface RecoveryDialogProps {
  drafts: DraftMetadata[];
  onRecover: (draftId: string) => void;
  onDiscard: (draftId: string) => void;
}

/** Matches this card, so `isModalOpen` can ask about every *other* modal. */
const CARD_SELECTOR = ".recovery-dialog";
const RECOVER_SELECTOR = ".recovery-recover";
const FOCUSABLE = "button:not([disabled])";
const VISIBLE_FOCUS: FocusOptions & { focusVisible?: boolean } = { focusVisible: true };

export function RecoveryDialog(props: RecoveryDialogProps) {
  if (props.drafts.length === 0) return null;
  return <RecoveryCard {...props} />;
}

/** The control that last had focus: its row, its place and the element. */
interface LastFocus {
  draftId: string;
  index: number;
  element: HTMLElement;
}

function RecoveryCard({ drafts, onRecover, onDiscard }: RecoveryDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const firstRecoverRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<LastFocus | null>(null);
  // Read at the first render, before this card is in the document.
  const [focusOnOpen] = useState(() => !isModalOpen());
  useReturnFocusOnClose(cardRef, focusActiveMilkdownAtEnd);
  useVisibleInitialFocus(firstRecoverRef, focusOnOpen);

  const recoverAt = (index: number): HTMLElement | null => {
    const buttons = cardRef.current?.querySelectorAll<HTMLElement>(RECOVER_SELECTOR) ?? [];
    return buttons.length === 0 ? null : buttons[Math.min(index, buttons.length - 1)];
  };
  const focusLost = () => document.activeElement === null || document.activeElement === document.body;

  // A removed row took focus with it: hand it to the Recover now at its place.
  const rowIds = drafts.map((d) => d.id).join("\n");
  const seenRowIds = useRef(rowIds);
  useLayoutEffect(() => {
    if (seenRowIds.current === rowIds) return;
    seenRowIds.current = rowIds;
    const last = lastFocus.current;
    if (!last || !focusLost() || drafts.some((d) => d.id === last.draftId)) return;
    recoverAt(last.index)?.focus(VISIBLE_FOCUS);
  });

  // A modal closed over Recovery left focus on <body>: take it back.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (!focusLost() || isModalOpen(CARD_SELECTOR)) return;
      const back = lastFocus.current?.element;
      (back?.isConnected ? back : recoverAt(0))?.focus(VISIBLE_FOCUS);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Tab / Shift+Tab wrap inside the card (rule 32).
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !cardRef.current) return;
    const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        ref={cardRef}
        className="dialog-card recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Recover drafts"
        onKeyDown={handleKeyDown}
      >
        <h3 className="dialog-title">Recover drafts</h3>
        <p className="dialog-message">
          We found unsaved drafts. Recover or discard them before continuing.
        </p>
        <div className="recovery-list">
          {drafts.map((draft, index) => (
            <div
              key={draft.id}
              className="recovery-item"
              onFocus={(e) => {
                lastFocus.current = { draftId: draft.id, index, element: e.target };
              }}
            >
              <div className="recovery-info">
                <div className="recovery-title">{draft.title}</div>
                <div className="recovery-path">
                  {draft.originalPath ? draft.originalPath : "Unsaved document"}
                </div>
                <div className="recovery-time">{draftTimeLabel(draft.lastModified)}</div>
              </div>
              <div className="recovery-actions">
                <button
                  ref={index === 0 ? firstRecoverRef : undefined}
                  className="toolbar-button recovery-recover"
                  type="button"
                  onClick={() => {
                    loggingService.logDialogAction("dialog.recovery.recover", "success", {
                      draftId: draft.id,
                    });
                    onRecover(draft.id);
                  }}
                >
                  Recover
                </button>
                <button
                  className="toolbar-button"
                  type="button"
                  onClick={() => {
                    loggingService.logDialogAction("dialog.recovery.discard", "cancel", {
                      draftId: draft.id,
                    });
                    onDiscard(draft.id);
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
