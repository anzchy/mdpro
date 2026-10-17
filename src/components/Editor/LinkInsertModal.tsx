/**
 * @module LinkInsertModal
 * Purpose: React inline modal for inserting a hyperlink in WYSIWYG and Source
 * mode. Replaces the unreliable window.prompt() (issue #25; Source mode D55)
 * with a visible overlay that works correctly inside Tauri's WKWebView on macOS.
 * Its log lines carry the requesting editor as `screen` (store `mode`).
 *
 * Lifecycle:
 *   - Renders when useLinkInsertStore.pendingCallback is set (⌘K pressed).
 *   - User types URL and presses Enter in the URL field (D230-WI-2; not while
 *     an IME is composing, D230-WI-3) or clicks "Insert".
 *   - Calls pendingCallback(url) to apply the link (ProseMirror mark, or
 *     `[text](url)` in Source mode).
 *   - Calls clearPendingCallback() to hide the modal.
 *   - ESC or "Cancel" calls clearPendingCallback() without applying.
 *   - Tab and Shift-Tab wrap inside the card (rule 33 modal loop, D230): the
 *     last enabled control is Cancel while the URL is empty, Insert after.
 *   - useLinkInsertBinding clears the request (the modal unmounts) when the
 *     active document switches or closes, or the view mode changes (D73); that
 *     path logs `ui.link-insert.cancel`, not `ui.link-modal.cancel`.
 *   - Every close gives focus back (D259): the card is mounted only while a
 *     request is pending, so `useReturnFocusOnClose` captures what held focus
 *     at open (the editor) and returns it at unmount, or the active WYSIWYG
 *     editor's end if that element is gone. Source mode's own return
 *     (linkPlugin) runs first; the hook then leaves focus alone. The cancel
 *     and submit lines are logged at unmount, after that return, with
 *     `focusReturned`.
 *
 * @coordinates-with src/stores/linkInsertStore.ts
 * @coordinates-with src/plugins/milkdown/typoraKeymapPlugin.ts
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx
 * @coordinates-with src/components/Editor/SplitView.tsx — Source mode mount (D55)
 * @coordinates-with src/plugins/codemirror/linkPlugin.ts
 * @coordinates-with src/hooks/useLinkInsertBinding.ts — closes it on a stale request (D73)
 * @coordinates-with src/hooks/useReturnFocusOnClose.ts — the return on close (D259)
 * @coordinates-with src/utils/focusActiveMilkdownAtEnd.ts — its fallback
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReturnFocusOnClose } from "../../hooks/useReturnFocusOnClose";
import { useLinkInsertStore } from "../../stores/linkInsertStore";
import { loggingService } from "../../services/loggingService";
import { focusActiveMilkdownAtEnd } from "../../utils/focusActiveMilkdownAtEnd";

/** WebKit's keyCode for a keydown that belongs to an input method (also useDialogEscape). */
const IME_KEY_CODE = 229;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Whether focus left the closing card for a real element (not `<body>`). */
function focusReturnedFrom(card: HTMLElement | null): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body && !card?.contains(active);
}

export function LinkInsertModal() {
  const pendingCallback = useLinkInsertStore((state) => state.pendingCallback);
  if (pendingCallback === null) return null;
  return <LinkInsertCard />;
}

function LinkInsertCard() {
  const mode = useLinkInsertStore((state) => state.mode);
  const [urlValue, setUrlValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // The close's log line, written at unmount once focus has been returned (D259).
  const logOnClose = useRef<((focusReturned: boolean) => void) | null>(null);
  useReturnFocusOnClose(cardRef, focusActiveMilkdownAtEnd);
  // Declared after the hook, so its cleanup runs after the hook's return.
  useLayoutEffect(() => {
    const card = cardRef.current;
    return () => logOnClose.current?.(focusReturnedFrom(card));
  }, []);

  // Focus the URL field once the card is mounted.
  useEffect(() => {
    // Defer focus to next tick so the element is in the DOM
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    loggingService.logEventSync({
      level: "info",
      event: "ui.link-modal.open",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: { screen: mode },
    });
  }, [mode]);

  const handleSubmit = () => {
    const url = urlValue.trim();
    if (!url) return;

    const cb = useLinkInsertStore.getState().pendingCallback;
    logOnClose.current = (focusReturned) =>
      loggingService.logEventSync({
        level: "info",
        event: "ui.link-modal.submit",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: { screen: mode, urlLength: url.length, focusReturned },
      });
    useLinkInsertStore.getState().clearPendingCallback();

    if (cb) {
      cb(url);
    }
  };

  const handleCancel = () => {
    logOnClose.current = (focusReturned) =>
      loggingService.logEventSync({
        level: "info",
        event: "ui.link-modal.cancel",
        status: "cancel",
        actionId: loggingService.generateActionId(),
        context: { screen: mode, focusReturned },
      });
    useLinkInsertStore.getState().clearPendingCallback();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      // Only the URL field submits on Enter; on Cancel or Insert, Enter
      // activates that button (D230-WI-2).
      // An Enter that commits an IME candidate is not a submit (D230-WI-3, the
      // D219 family): isComposing, or WebKit's keyCode 229 for an IME keydown.
      if (e.nativeEvent.isComposing || e.keyCode === IME_KEY_CODE) return;
      if (e.target === inputRef.current) {
        e.preventDefault();
        handleSubmit();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    } else if (e.key === "Tab" && cardRef.current) {
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
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        // Dismiss on backdrop click
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        ref={cardRef}
        className="dialog-card link-insert-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Insert link"
        onKeyDown={handleKeyDown}
      >
        <h3 className="dialog-title">Insert Link</h3>
        <label className="link-insert-label" htmlFor="link-insert-url">
          URL
        </label>
        <input
          id="link-insert-url"
          ref={inputRef}
          className="link-insert-input"
          type="text"
          placeholder="https://example.com"
          value={urlValue}
          onChange={(e) => setUrlValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="dialog-actions">
          <button
            className="toolbar-button"
            onClick={handleCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="toolbar-button toolbar-button--primary"
            onClick={handleSubmit}
            type="button"
            disabled={urlValue.trim() === ""}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
