/**
 * @module linkInsertStore
 * Purpose: Holds the pending link-insert callback for the ⌘K shortcut in
 * WYSIWYG mode. Bridges the ProseMirror keymap (which runs synchronously)
 * with the React-based LinkInsertModal that collects the URL asynchronously.
 *
 * Flow:
 *   1. User presses ⌘K in Milkdown editor.
 *   2. typoraKeymapPlugin calls setPendingCallback(fn) where fn(url) applies
 *      the link mark via ProseMirror dispatch.
 *   3. LinkInsertModal renders, user types URL and submits.
 *   4. Modal calls pendingCallback(url) then clearPendingCallback().
 *   5. ESC or cancel calls clearPendingCallback() without applying the link.
 */

import { create } from "zustand";

interface LinkInsertState {
  /** Callback set by the keymap when ⌘K is pressed. Null when modal is hidden. */
  pendingCallback: ((url: string) => void) | null;
  /** Set the pending callback — opens the modal. */
  setPendingCallback: (cb: (url: string) => void) => void;
  /** Clear the pending callback — closes the modal. */
  clearPendingCallback: () => void;
}

export const useLinkInsertStore = create<LinkInsertState>((set) => ({
  pendingCallback: null,
  setPendingCallback: (cb) => set({ pendingCallback: cb }),
  clearPendingCallback: () => set({ pendingCallback: null }),
}));
