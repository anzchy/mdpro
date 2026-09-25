/**
 * Purpose: the discard snapshot for the quit re-check (ADR-0035 A3). When the
 * user confirms Discard for quit request R, the window records `{id → content}`
 * for the documents it discarded. A later re-check for R compares the post-flush
 * store against that record, so a discarded document that is still modified but
 * unchanged does not raise the quit dialog a second time — while an edit to it,
 * or to any other document, still does.
 *
 * Pipeline: confirmQuit (flush → read store) → `takeDiscardSnapshot(R, docs, ids)`
 *   → re-check (flush → read store) → `unsavedSinceDiscard(assessment, docs, snap, R)`
 *   → "dirty" | "clean". The backstop writer uses `isDiscardedUnchanged` to skip the
 *   same documents.
 *
 * Key decisions:
 * - Keyed to the request. A snapshot for R never applies to R′ ≠ R, so a cancelled
 *   quit cannot silence the next one.
 * - Content, not identity. The snapshot copies each content string into its own
 *   Map, so later mutation of the caller's objects or id list cannot change it.
 * - A failed flush is dirty regardless: an edit exists that the store never saw.
 * - The count is metadata only (`discardedUnchangedCount`); nothing here logs.
 *
 * @coordinates-with src/utils/dataLossGuards.ts — `assessWindowUnsaved` produces
 *   the assessment this reads
 * @coordinates-with src/utils/quitDraftBackstop.ts — skips unchanged discarded docs
 * @coordinates-with src/hooks/useQuitGuard.ts — takes the snapshot at Discard and
 *   answers the re-check (ADR-0035 WI-8)
 */

/** What the window discarded for one quit request: id → content at Discard. */
export interface DiscardSnapshot {
  readonly requestId: number;
  readonly contents: ReadonlyMap<string, string>;
}

/** The fields of a document the snapshot needs. */
export interface SnapshotDocument {
  readonly id: string;
  readonly content: string;
}

/** The re-check's verdict for a window that may have discarded documents. */
export interface UnsavedSinceDiscard {
  dirty: boolean;
  /** Modified documents that are in the snapshot with identical content. */
  discardedUnchangedCount: number;
}

/** The subset of `WindowUnsavedAssessment` the re-check reads. */
export interface RecheckAssessment {
  readonly flushFailed: boolean;
  readonly dirtyDocuments: readonly { readonly id: string }[];
}

/**
 * Record the content of each discarded document, for request `requestId`. Ids not
 * present in `documents` are skipped. The result shares nothing with its inputs.
 */
export function takeDiscardSnapshot(
  requestId: number,
  documents: readonly SnapshotDocument[],
  discardedIds: readonly string[],
): DiscardSnapshot {
  const wanted = new Set(discardedIds);
  const contents = new Map<string, string>();
  for (const doc of documents) {
    if (wanted.has(doc.id)) contents.set(doc.id, doc.content);
  }
  return { requestId, contents };
}

/**
 * True iff `doc` was discarded for this same request and its content has not
 * changed since. A missing snapshot or a different request is never a match.
 */
export function isDiscardedUnchanged(
  snapshot: DiscardSnapshot | null | undefined,
  requestId: number | undefined,
  doc: SnapshotDocument,
): boolean {
  if (!snapshot || snapshot.requestId !== requestId) return false;
  return snapshot.contents.get(doc.id) === doc.content;
}

/**
 * The re-check rule. `assessment` and `documents` must both come from the store
 * read after the flush. Dirty iff the flush failed, or some modified document is
 * not a discarded-and-unchanged one. A modified id missing from `documents` counts
 * as dirty (it cannot be proven unchanged).
 */
export function unsavedSinceDiscard(
  assessment: RecheckAssessment,
  documents: readonly SnapshotDocument[],
  snapshot: DiscardSnapshot | null | undefined,
  requestId: number,
): UnsavedSinceDiscard {
  const byId = new Map(documents.map((doc) => [doc.id, doc] as const));
  let discardedUnchangedCount = 0;
  for (const { id } of assessment.dirtyDocuments) {
    const doc = byId.get(id);
    if (doc && isDiscardedUnchanged(snapshot, requestId, doc)) discardedUnchangedCount += 1;
  }
  const changed = assessment.dirtyDocuments.length > discardedUnchangedCount;
  return { dirty: assessment.flushFailed || changed, discardedUnchangedCount };
}
