/**
 * Purpose: the frontend half of the quit draft backstop (ADR-0035 WI-7). Just
 * before the quit commits, every window drafts every modified document it holds —
 * active or background — so an edit made after the window answered the quit
 * prompt survives as a recoverable draft.
 *
 * Pipeline: `assessWindowUnsaved("app-quit")` (flush pending WYSIWYG edits, then
 *   read the store) → modified docs minus discarded-and-unchanged ones (A3) →
 *   `save_draft` for each, concurrently, under `Promise.allSettled` → counts.
 *
 * Key decisions:
 * - Flush before read, and read `useDocumentStore.getState()` at call time — never
 *   a captured value (rule 50 §1). An edit inside the edit-sync delay is drafted.
 * - Nothing is filtered by the active tab.
 * - The promise resolves only after every write has settled. The Rust side closes
 *   the draft gate after the `drafted` reply, so a write still in flight at reply
 *   time would race the commit.
 * - A failed flush adds 1 to `failedCount`: an edit exists that the store never
 *   received, so no draft can contain it.
 * - Silent by design. The caller (`useQuitGuard`) logs the counts; a rejected
 *   `save_draft`'s error can carry a path or id, so it is never read here.
 * - A discarded document that was edited since is a target (it is not
 *   unchanged), and when its write resolves it is named in `undiscardedIds`
 *   (ADR-0035 review M-1): Rust would otherwise delete the new draft with the
 *   discard. A failed write is not named.
 *
 * @coordinates-with src/utils/dataLossGuards.ts — `assessWindowUnsaved`
 * @coordinates-with src/utils/quitDiscardSnapshot.ts — `isDiscardedUnchanged`
 * @coordinates-with src/utils/draftTitle.ts — the same title rule as autosave
 * @coordinates-with src/hooks/useAutoSave.ts — the same `save_draft` payload shape
 * @coordinates-with src/hooks/useQuitGuard.ts — calls this on `app:quit-backstop`
 *   and replies `drafted` with the counts (ADR-0035 WI-8)
 */
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "../stores/documentStore";
import { assessWindowUnsaved } from "./dataLossGuards";
import { extractTitle } from "./draftTitle";
import { isDiscardedUnchanged, type DiscardSnapshot } from "./quitDiscardSnapshot";

/** What one window's backstop did. Counts and a flag only — never ids or content. */
export interface QuitBackstopResult {
  /** `save_draft` calls that resolved. */
  draftedCount: number;
  /** `save_draft` calls that rejected, plus 1 if the flush failed. */
  failedCount: number;
  flushFailed: boolean;
}

/** The discard snapshot, if any, and the request this backstop belongs to. */
export interface QuitBackstopOptions {
  snapshot?: DiscardSnapshot | null;
  requestId?: number;
}

/** The counts, plus the ids whose discard this backstop's redraft cancels. */
export interface QuitBackstopOutcome {
  counts: QuitBackstopResult;
  /**
   * Documents discarded for `requestId` and edited since, whose redraft resolved
   * (ADR-0035 review M-1). They travel on the `drafted` reply so Rust keeps the
   * draft instead of deleting it; they never go into a log.
   */
  undiscardedIds: string[];
}

/**
 * Flush, then draft every modified document in this window except those discarded
 * for `requestId` and unchanged since. Never rejects.
 */
export async function writeQuitBackstopDrafts(
  options: QuitBackstopOptions = {},
): Promise<QuitBackstopResult> {
  return (await writeQuitBackstopDraftsWithIds(options)).counts;
}

/**
 * `writeQuitBackstopDrafts`, also naming the discarded-then-edited documents whose
 * draft was written. A failed write is not named, so its discard still deletes the
 * older draft rather than keeping one that does not hold the edit. Never rejects.
 */
export async function writeQuitBackstopDraftsWithIds(
  options: QuitBackstopOptions = {},
): Promise<QuitBackstopOutcome> {
  const { flushFailed, dirtyDocuments } = assessWindowUnsaved("app-quit");
  const dirtyIds = new Set(dirtyDocuments.map((ref) => ref.id));
  const targets = useDocumentStore
    .getState()
    .documents.filter(
      (doc) =>
        dirtyIds.has(doc.id) && !isDiscardedUnchanged(options.snapshot, options.requestId, doc),
    );

  const outcomes = await Promise.allSettled(
    // async: a synchronous throw from `invoke` still lands in allSettled.
    targets.map(async (doc) =>
      invoke("save_draft", {
        documentId: doc.id,
        content: doc.content,
        originalPath: doc.path,
        title: extractTitle(doc.content),
      }),
    ),
  );

  const rejected = outcomes.filter((outcome) => outcome.status === "rejected").length;
  const { snapshot, requestId } = options;
  const ownRequest = snapshot != null && snapshot.requestId === requestId;
  const undiscardedIds = targets
    .filter((doc, i) => ownRequest && snapshot.contents.has(doc.id) && outcomes[i].status === "fulfilled")
    .map((doc) => doc.id);
  return {
    counts: {
      draftedCount: outcomes.length - rejected,
      failedCount: rejected + (flushFailed ? 1 : 0),
      flushFailed,
    },
    undiscardedIds,
  };
}
