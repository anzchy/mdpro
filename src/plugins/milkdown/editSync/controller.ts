/**
 * Purpose: The pure edit-sync controller behind the WYSIWYG editor (D15/D18). It
 * decides when edits made in Milkdown reach `documentStore`: it marks the owning
 * document dirty the moment a user edit happens, debounces serialization, and gives
 * callers a synchronous `flush(reason)` for decision points (save, view-mode switch,
 * tab switch/close, window close). It imports no Milkdown and no React. The plugin
 * layer feeds it doc-change notifications and a serializer closure.
 *
 * Pipeline: onDocChanged({ userEdit }) → revision++ (+ dirty on a user edit when
 * clean) → one trailing timer (EDIT_SYNC_DELAY_MS) → write(); flush/destroy call
 * write() synchronously → getMarkdown() → documentStore.updateDocumentContent on
 * the bound documentId.
 *
 * Key decisions:
 * - The owner documentId is bound at construction. Writes never follow
 *   `activeDocumentId`, so an editor torn down after a tab switch writes only its
 *   own document.
 * - `addToHistory === false` transactions (`userEdit: false`) do NOT mark dirty
 *   immediately. They bump the revision and schedule a serialize. At write time the
 *   controller writes only if the markdown differs from what it last wrote
 *   (initialised to the baseline serialized from the loaded doc), or if the store
 *   was changed underneath it. Milkdown's syncHeadingIdPlugin dispatches a
 *   doc-changing, history-less transaction on init and on every change
 *   (src/utils/tocElementResolution.ts) that only touches heading ids. That must not
 *   dirty a freshly opened document. Programmatic edits that do change the markdown
 *   (MCP replaceAll, history-less plugin edits) still persist.
 * - Dirty is written only on the clean→dirty edge, so typing causes no
 *   per-keystroke documents-array churn. `onDocChanged` never serializes: typing
 *   stays O(1) per key, and serialization happens once per debounce window.
 * - Revision guard: a write settles `lastWrittenRevision`. A timer or flush with no
 *   newer revision writes nothing. A serializer failure does not settle the
 *   revision, so the next flush retries it.
 * - `destroy` flushes once, then is terminal: every later call returns
 *   `"destroyed"`, never writes and never throws.
 * - `discard` is terminal WITHOUT a write (D15-WI-5). A wholesale replacement of the
 *   document from outside the editor (file reload, MCP write_document) makes this
 *   editor's doc stale; flushing it would write the stale text over the new content.
 * - The controller never sets `isModified` to false. Only save does that.
 * - Logging: explicit flushes and destroy log `editor.milkdown.flush` with
 *   `{ reason, documentId, outcome }` only, never markdown, text or length. Timer
 *   writes are silent. A serializer failure logs warn / fail on any path.
 *
 * @coordinates-with src/stores/documentStore.ts — writes via markDocumentModified /
 *   updateDocumentContent on the bound document only
 * @coordinates-with src/services/loggingService.ts — `editor.milkdown.flush` events
 * @coordinates-with src/utils/tocElementResolution.ts — the history-less heading-id
 *   sync transactions the `userEdit: false` rule exists for
 * @module plugins/milkdown/editSync/controller
 */
import { useDocumentStore } from "../../../stores/documentStore";
import { loggingService } from "../../../services/loggingService";

/** Trailing debounce between the last doc change and the serialize-and-write. */
export const EDIT_SYNC_DELAY_MS = 200;

const FLUSH_EVENT = "editor.milkdown.flush";
const TIMER_REASON = "timer";

export type EditSyncStatus = "written" | "clean" | "failed" | "destroyed";

export interface EditSyncResult {
  status: EditSyncStatus;
}

export interface OnDocChangedResult {
  status: "scheduled" | "destroyed";
}

export interface EditSyncControllerOptions {
  /** The document this editor instance was mounted for. Never re-resolved. */
  documentId: string;
  /** Serializes the editor's current doc to markdown. May throw. */
  getMarkdown: () => string;
  /** Markdown serialized from the doc as loaded, before any change. */
  baselineMarkdown: string;
  delayMs?: number;
}

export interface EditSyncController {
  /** Record one doc-changing update batch. `userEdit` is false only when every
   *  transaction in the batch had `addToHistory === false`. */
  onDocChanged(change: { userEdit: boolean }): OnDocChangedResult;
  /** Synchronously cancel the timer and write any pending change. */
  flush(reason: string): EditSyncResult;
  /** Flush once, then become a terminal no-op. */
  destroy(reason: string): EditSyncResult;
  /** Drop any pending change unwritten and become terminal. Returns whether a change
   *  was pending. */
  discard(): boolean;
}

export function createEditSyncController(
  options: EditSyncControllerOptions,
): EditSyncController {
  const { documentId, getMarkdown, baselineMarkdown } = options;
  const delayMs = options.delayMs ?? EDIT_SYNC_DELAY_MS;

  let revision = 0;
  let lastWrittenRevision = 0;
  let lastWrittenMarkdown = baselineMarkdown;
  // What the controller believes the store holds. If the store differs, something
  // external wrote it, and an unchanged serialization must still be written back.
  let expectedStoreContent = findOwner()?.content;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  function findOwner() {
    return useDocumentStore.getState().documents.find((doc) => doc.id === documentId);
  }

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function logFailure(reason: string, error: unknown): void {
    loggingService.logEventSync({
      level: "warn",
      event: FLUSH_EVENT,
      status: "fail",
      actionId: loggingService.generateActionId(),
      context: { reason, documentId, outcome: "failed" },
      error: error instanceof Error ? error.message : String(error),
    });
  }

  function logOutcome(reason: string, outcome: EditSyncStatus): void {
    if (outcome === "failed") return; // already logged with the error
    loggingService.logEventSync({
      level: "info",
      event: FLUSH_EVENT,
      status: "success",
      actionId: loggingService.generateActionId(),
      context: { reason, documentId, outcome },
    });
  }

  /** Serialize and write if there is an unsettled revision. Never throws. */
  function write(reason: string): EditSyncStatus {
    if (revision <= lastWrittenRevision) return "clean";
    const owner = findOwner();
    if (!owner) {
      lastWrittenRevision = revision;
      return "clean";
    }
    const target = revision;
    let markdown: string;
    try {
      markdown = getMarkdown();
    } catch (error) {
      logFailure(reason, error);
      return "failed";
    }
    lastWrittenRevision = target;
    const unchangedSinceLastWrite =
      markdown === lastWrittenMarkdown && owner.content === expectedStoreContent;
    if (markdown === owner.content || unchangedSinceLastWrite) return "clean";
    useDocumentStore.getState().updateDocumentContent(documentId, markdown);
    lastWrittenMarkdown = markdown;
    expectedStoreContent = markdown;
    return "written";
  }

  function onTimer(): void {
    timer = null;
    if (destroyed) return;
    write(TIMER_REASON);
  }

  return {
    onDocChanged({ userEdit }) {
      if (destroyed) return { status: "destroyed" };
      revision += 1;
      if (userEdit) {
        const owner = findOwner();
        if (owner && !owner.isModified) {
          useDocumentStore.getState().markDocumentModified(documentId, true);
        }
      }
      cancelTimer();
      timer = setTimeout(onTimer, delayMs);
      return { status: "scheduled" };
    },

    flush(reason) {
      if (destroyed) return { status: "destroyed" };
      cancelTimer();
      const status = write(reason);
      logOutcome(reason, status);
      return { status };
    },

    destroy(reason) {
      if (destroyed) return { status: "destroyed" };
      cancelTimer();
      const status = write(reason);
      destroyed = true;
      logOutcome(reason, status);
      return { status };
    },

    discard() {
      if (destroyed) return false;
      cancelTimer();
      destroyed = true;
      return revision > lastWrittenRevision;
    },
  };
}
