/**
 * @module milkdownEditorStore
 * Purpose: Bridges the active Milkdown editor instance from
 * `MilkdownEditor.tsx` (where the React-tree owns it) to app-level
 * callbacks (e.g. `App.tsx` `onInsertTable`) that need to dispatch
 * commands against the editor, and holds the per-document edit-sync
 * flusher registry that decision points (save, view-mode switch, tab
 * switch/close, window close) call to push pending WYSIWYG edits into
 * `documentStore` synchronously (D15).
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
 * Flusher registry flow:
 *   1. The edit-sync plugin's view init calls `registerFlusher(documentId, fn)`
 *      and keeps the returned cleanup; its view destroy runs that cleanup.
 *   2. Decision points call `flushPendingEdits(reason)`, which runs every live
 *      flusher and aggregates: `failed` if any failed or threw, else `written`
 *      if any wrote, else `clean`. A flusher's `destroyed` counts as `clean`.
 *
 * Reload flow (D15-WI-5): a wholesale replacement of an open document's content
 * from outside the editor (file reload, MCP write_document) keeps the document id,
 * so the id-keyed editor would stay on the stale doc. In the same synchronous block
 * as its store write, the caller runs `reloadEditor(documentId, reason)` (via
 * `utils/wholesaleReplace.ts`): every live registration for that id
 * is discarded (pending edits dropped, no write), and `editorGenerations[id]` is
 * bumped. MilkdownEditor keys its provider on `id#generation`, so it rebuilds from
 * the new content. The editor's own writes never bump it, so typing never rebuilds.
 *
 * Key decisions:
 * - Registrations are a per-id stack of unique entries. A cleanup removes only
 *   its own entry and is idempotent, so a remount under the same id whose old
 *   editor is destroyed late (Milkdown's destroy is async) never removes the
 *   newer registration. The live flusher is the newest un-cleaned entry.
 * - `flushPendingEdits` never throws and never short-circuits: every document's
 *   flusher runs even after one fails, so a save cannot skip another tab's edit.
 *
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx
 * @coordinates-with src/plugins/milkdown/editSync/plugin.ts — registers flushers
 * @coordinates-with src/App.tsx
 * @coordinates-with src/utils/wholesaleReplace.ts — the reloadEditor caller
 */

import { create } from "zustand";
import { loggingService } from "../services/loggingService";

/** What one editor's flusher reports (the edit-sync controller's statuses). */
export type FlusherStatus = "written" | "clean" | "failed" | "destroyed";

/** Aggregate over every registered flusher. Never `destroyed`. */
export type FlushStatus = "written" | "clean" | "failed";

export interface FlushResult {
  status: FlushStatus;
}

export type Flusher = (reason: string) => { status: FlusherStatus };

/** One registration. Its object identity is what its cleanup removes. */
export interface FlusherRegistration {
  readonly flush: Flusher;
  /** Terminal, write-free teardown for a wholesale replacement. Returns whether a
   *  pending change was dropped. */
  readonly discard?: () => boolean;
}

const FLUSH_RANK: Record<FlushStatus, number> = { clean: 0, written: 1, failed: 2 };

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
  /**
   * Live flusher registrations per document id, newest last. An id is
   * present only while it has at least one un-cleaned registration.
   */
  flushers: Record<string, readonly FlusherRegistration[]>;
  /**
   * Register `flush` for `documentId`. The returned cleanup removes only
   * this registration and is idempotent.
   */
  registerFlusher: (
    documentId: string,
    flush: Flusher,
    discard?: () => boolean,
  ) => () => void;
  /**
   * Synchronously flush every document's pending WYSIWYG edits into
   * documentStore. Returns `clean` when nothing is registered.
   */
  flushPendingEdits: (reason: string) => FlushResult;
  /** Per-document editor generation. Absent means 0. */
  editorGenerations: Record<string, number>;
  /**
   * Call in the same synchronous block as a wholesale store write for `documentId`
   * (before or after it): discard that document's live editors without writing, then
   * bump its generation so the editor rebuilds on the next render.
   */
  reloadEditor: (documentId: string, reason: string) => void;
}

const NULL_GETTER = (): unknown => null;

function runFlusher(documentId: string, flush: Flusher, reason: string): FlushStatus {
  try {
    const { status } = flush(reason);
    return status === "destroyed" ? "clean" : status;
  } catch (error) {
    loggingService.logEventSync({
      level: "warn",
      event: "editor.milkdown.flush",
      status: "fail",
      actionId: loggingService.generateActionId(),
      context: { reason, documentId, outcome: "failed" },
      error: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }
}

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

  flushers: {},
  registerFlusher: (documentId, flush, discard) => {
    const registration: FlusherRegistration = { flush, discard };
    set((state) => ({
      flushers: {
        ...state.flushers,
        [documentId]: [...(state.flushers[documentId] ?? []), registration],
      },
    }));
    return () => {
      const current = get().flushers[documentId];
      if (!current || !current.includes(registration)) return;
      const remaining = current.filter((r) => r !== registration);
      const next = { ...get().flushers };
      if (remaining.length > 0) next[documentId] = remaining;
      else delete next[documentId];
      set({ flushers: next });
    };
  },
  flushPendingEdits: (reason) => {
    let aggregate: FlushStatus = "clean";
    for (const [documentId, registrations] of Object.entries(get().flushers)) {
      const live = registrations[registrations.length - 1];
      if (!live) continue;
      const status = runFlusher(documentId, live.flush, reason);
      if (FLUSH_RANK[status] > FLUSH_RANK[aggregate]) aggregate = status;
    }
    return { status: aggregate };
  },

  editorGenerations: {},
  reloadEditor: (documentId, reason) => {
    let droppedPendingEdit = false;
    for (const registration of get().flushers[documentId] ?? []) {
      if (registration.discard?.()) droppedPendingEdit = true;
    }
    const generation = (get().editorGenerations[documentId] ?? 0) + 1;
    set({ editorGenerations: { ...get().editorGenerations, [documentId]: generation } });
    loggingService.logEventSync({
      level: "info",
      event: "editor.milkdown.reload",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: { reason, documentId, generation, droppedPendingEdit },
    });
  },
}));
