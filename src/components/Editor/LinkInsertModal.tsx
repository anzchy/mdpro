/**
 * @module LinkInsertModal
 * Purpose: React inline modal for inserting a hyperlink in WYSIWYG and Source
 * mode. Replaces the unreliable window.prompt() (issue #25; Source mode D55)
 * with a visible overlay that works correctly inside Tauri's WKWebView on macOS.
 * Its log lines carry the requesting editor as `screen` (store `mode`).
 *
 * Lifecycle:
 *   - Renders when useLinkInsertStore.pendingCallback is set (⌘K pressed).
 *   - User types URL and presses Enter or clicks "Insert".
 *   - Calls pendingCallback(url) to apply the link (ProseMirror mark, or
 *     `[text](url)` in Source mode).
 *   - Calls clearPendingCallback() to hide the modal.
 *   - ESC or "Cancel" calls clearPendingCallback() without applying.
 *   - useLinkInsertBinding clears the request (the modal unmounts) when the
 *     active document switches or closes, or the view mode changes (D73); that
 *     path logs `ui.link-insert.cancel`, not `ui.link-modal.cancel`.
 *
 * @coordinates-with src/stores/linkInsertStore.ts
 * @coordinates-with src/plugins/milkdown/typoraKeymapPlugin.ts
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx
 * @coordinates-with src/components/Editor/SplitView.tsx — Source mode mount (D55)
 * @coordinates-with src/plugins/codemirror/linkPlugin.ts
 * @coordinates-with src/hooks/useLinkInsertBinding.ts — closes it on a stale request (D73)
 */

import { useEffect, useRef, useState } from "react";
import { useLinkInsertStore } from "../../stores/linkInsertStore";
import { loggingService } from "../../services/loggingService";

export function LinkInsertModal() {
  const pendingCallback = useLinkInsertStore((state) => state.pendingCallback);
  const mode = useLinkInsertStore((state) => state.mode);
  const [urlValue, setUrlValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isOpen = pendingCallback !== null;

  // Reset input and focus when modal opens
  useEffect(() => {
    if (isOpen) {
      setUrlValue("");
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
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const url = urlValue.trim();
    if (!url) return;

    const cb = useLinkInsertStore.getState().pendingCallback;
    useLinkInsertStore.getState().clearPendingCallback();

    if (cb) {
      cb(url);
    }

    loggingService.logEventSync({
      level: "info",
      event: "ui.link-modal.submit",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: { screen: mode, urlLength: url.length },
    });
  };

  const handleCancel = () => {
    useLinkInsertStore.getState().clearPendingCallback();
    loggingService.logEventSync({
      level: "info",
      event: "ui.link-modal.cancel",
      status: "cancel",
      actionId: loggingService.generateActionId(),
      context: { screen: mode },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
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
