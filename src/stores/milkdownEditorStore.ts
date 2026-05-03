/**
 * @module milkdownEditorStore
 * Purpose: Bridges the active Milkdown editor instance from
 * `MilkdownEditor.tsx` (where the React-tree owns it) to app-level
 * callbacks (e.g. `App.tsx` `onInsertTable`) that need to dispatch
 * commands against the editor.
 *
 * The store holds a `getEditor` function rather than the editor
 * instance itself. The function is called fresh on every read so the
 * caller always sees the current editor — important because Milkdown's
 * `useEditor` returns a new instance whenever `activeDocumentId`
 * changes (the editor is keyed on document id and remounted).
 *
 * Flow:
 *   1. MilkdownEditorInner mounts and calls
 *      `registerEditor(() => editor.get())`.
 *   2. App-level callbacks read `getEditor()` to obtain the current
 *      Milkdown editor instance.
 *   3. MilkdownEditorInner unmounts and calls `unregisterEditor()`,
 *      restoring the null getter.
 *
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx
 * @coordinates-with src/App.tsx
 */

import { create } from "zustand";

interface MilkdownEditorState {
  /**
   * Returns the active Milkdown editor instance (or null when no
   * MilkdownEditorInner is mounted, e.g. pure source mode).
   */
  getEditor: () => unknown;
  /**
   * Called by MilkdownEditorInner on mount. Returns a cleanup function
   * that, when invoked, only unregisters if the active getter is still
   * the one this register call set — protects against an out-of-order
   * remount where a newer MilkdownEditorInner registered before the
   * older one's cleanup ran (audit fix M2).
   */
  registerEditor: (getter: () => unknown) => () => void;
  /**
   * Force-clear the active getter. Prefer the cleanup returned from
   * `registerEditor` so the active-instance check is preserved; this
   * exists for tests and explicit teardown only.
   */
  unregisterEditor: () => void;
}

const NULL_GETTER = (): unknown => null;

export const useMilkdownEditorStore = create<MilkdownEditorState>((set, get) => ({
  getEditor: NULL_GETTER,
  registerEditor: (getter) => {
    set({ getEditor: getter });
    return () => {
      // Audit fix H6: only clear when our getter is still active.
      // Comparing against the *current* state (via get()) — not a
      // pre-register snapshot — is what makes this correct.
      if (get().getEditor === getter) {
        set({ getEditor: NULL_GETTER });
      }
    };
  },
  unregisterEditor: () => set({ getEditor: NULL_GETTER }),
}));
