/**
 * @module tableInsertStore
 * Purpose: Holds the pending table-insert callback for the ⌘⌥T shortcut
 * and Format → Insert Table menu item. Bridges the app-level keymap and
 * native menu (which run synchronously) with the React-based
 * TableInsertModal that collects rows × cols asynchronously.
 *
 * Mirrors `linkInsertStore` so the patterns stay parallel — when a future
 * refactor extracts a generic "request modal input" abstraction, both
 * stores will collapse cleanly.
 *
 * Flow:
 *   1. User presses ⌘⌥T (or clicks Format → Insert Table).
 *   2. useKeyboardShortcuts / useMenuEvents calls
 *      `useTableInsertStore.getState().requestInsert(fn)`
 *      where `fn(rows, cols)` runs `insertTableCommand` against the
 *      Milkdown editor.
 *   3. TableInsertModal renders, user picks dimensions, and submits.
 *   4. Modal calls `pendingCallback(rows, cols)` then `clearPending()`.
 *   5. Esc / cancel calls `clearPending()` without running the callback.
 *
 * @coordinates-with src/components/Editor/TableInsertModal/index.tsx (planned)
 * @coordinates-with src/hooks/useKeyboardShortcuts.ts
 * @coordinates-with src/hooks/useMenuEvents.ts
 */

import { create } from "zustand";

interface TableInsertState {
  /** Callback set by the keymap / menu when ⌘⌥T fires. Null when modal is hidden. */
  pendingCallback: ((rows: number, cols: number) => void) | null;
  /** Set the pending callback — opens the modal. */
  requestInsert: (cb: (rows: number, cols: number) => void) => void;
  /** Clear the pending callback — closes the modal. */
  clearPending: () => void;
}

export const useTableInsertStore = create<TableInsertState>((set) => ({
  pendingCallback: null,
  requestInsert: (cb) => set({ pendingCallback: cb }),
  clearPending: () => set({ pendingCallback: null }),
}));
