/**
 * @module linkInsertStore
 * Purpose: Holds the pending link-insert callback for the ⌘K shortcut in
 * both editors. Bridges the editor keymap (which runs synchronously) with the
 * React-based LinkInsertModal that collects the URL asynchronously.
 *
 * Flow:
 *   1. User presses ⌘K in the Milkdown or the CodeMirror (Source) editor.
 *   2. typoraKeymapPlugin calls setPendingCallback(fn) where fn(url) applies
 *      the link mark via ProseMirror dispatch; Source mode's insertLinkCommand
 *      (codemirror/linkPlugin.ts) calls setPendingCallback(fn, "source") where
 *      fn(url) inserts `[text](url)` (D55 — it used window.prompt, which the
 *      packaged app never shows).
 *   3. LinkInsertModal renders, user types URL and submits.
 *   4. Modal calls pendingCallback(url) then clearPendingCallback().
 *   5. ESC or cancel calls clearPendingCallback() without applying the link.
 */

import { create } from "zustand";

/** Which editor asked for the link; the modal logs it as `screen`. */
export type LinkInsertMode = "wysiwyg" | "source";

interface LinkInsertState {
  /** Callback set by the keymap when ⌘K is pressed. Null when modal is hidden. */
  pendingCallback: ((url: string) => void) | null;
  /** The editor that set the current (or last) callback. */
  mode: LinkInsertMode;
  /** Set the pending callback — opens the modal. `mode` defaults to "wysiwyg". */
  setPendingCallback: (cb: (url: string) => void, mode?: LinkInsertMode) => void;
  /** Clear the pending callback — closes the modal. */
  clearPendingCallback: () => void;
}

export const useLinkInsertStore = create<LinkInsertState>((set) => ({
  pendingCallback: null,
  mode: "wysiwyg",
  setPendingCallback: (cb, mode = "wysiwyg") => set({ pendingCallback: cb, mode }),
  clearPendingCallback: () => set({ pendingCallback: null }),
}));
