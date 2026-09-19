/**
 * Purpose: the archive/swap helpers behind `tocStore.setEntries`'s document scoping —
 * the per-document triple, the document swap, and the conservation prune.
 *
 * Why this file exists: `tocStore.ts` breached rule 50 §6's 300-line cap once WI-3.5.3
 * added scoping, and the plan named this extraction as the fallback. Only the *archive*
 * mechanics moved. The matcher (`src/utils/headingCoordination.ts`) stays where it is
 * and is deliberately **not** inlined here: it is pure, has no notion of a store, and is
 * covered as a critical path in its own right.
 *
 * Nothing here touches Zustand or module-scope mutable state — every function is a pure
 * function of the values it is handed, so the store's `set()` callback stays the only
 * place state actually changes.
 */
import type { HeadingKey, TOCEntry } from "../types/toc";

/**
 * One document's TOC state, as held in the archive.
 *
 * `headings` is the **keyed** heading list, not just the collapsed keys. Archiving only
 * the collapsed set would look sufficient and be wrong: on return the matcher would have
 * no previous revision to coordinate against, would re-mint every key, and the restored
 * set would point at keys nobody holds any more — a collapse set that silently prunes
 * itself to empty (matrix case S6).
 */
export interface DocumentTOCState {
  headings: TOCEntry[];
  collapsed: Set<HeadingKey>;
  active: HeadingKey | null;
}

/**
 * A document nobody has visited yet.
 *
 * A factory, not a shared constant: handing the same mutable `Set` to two documents is
 * one accidental in-place `add` away from the cross-document leak WI-3.5.3 exists to
 * close.
 */
export function emptyDocumentState(): DocumentTOCState {
  return { headings: [], collapsed: new Set<HeadingKey>(), active: null };
}

/**
 * Drop every collapsed key that the new revision retired.
 *
 * Returns the **same Set reference** when nothing was pruned. That is not a
 * micro-optimisation: a fresh `Set` on every keystroke is the original defect's shape
 * surviving as a re-render storm in every per-field subscriber (matrix case S3).
 */
export function pruneCollapsed(
  collapsed: Set<HeadingKey>,
  present: Set<HeadingKey>,
): Set<HeadingKey> {
  let retired = false;
  for (const key of collapsed) {
    if (!present.has(key)) {
      retired = true;
      break;
    }
  }
  if (!retired) return collapsed;

  const kept = new Set<HeadingKey>();
  for (const key of collapsed) {
    if (present.has(key)) kept.add(key);
  }
  return kept;
}

/**
 * Drop one document from the archive — the archive half of
 * `tocStore.resetCoordination` (WI-3.5.5).
 *
 * It lives here rather than inline in the store for the same reason `swapDocument` does:
 * `byDocument` is this module's structure, and a second place that rebuilds it is a
 * second place that can forget the "the current document is never in its own archive"
 * rule. The store keeps only the flat-triple half, which is Zustand's business.
 *
 * Returns the **same Map reference** when `documentId` was not archived (including the
 * `null` id, which is never a key), mirroring {@link pruneCollapsed}: eviction is on the
 * close / reload path, and allocating a fresh Map for a no-op would churn every
 * subscriber for nothing.
 */
export function evictDocument(
  byDocument: Map<string, DocumentTOCState>,
  documentId: string | null,
): Map<string, DocumentTOCState> {
  if (documentId === null || !byDocument.has(documentId)) return byDocument;
  const next = new Map(byDocument);
  next.delete(documentId);
  return next;
}

/** The outgoing document's triple, plus the id it belongs to. */
export interface CurrentDocument extends DocumentTOCState {
  documentId: string | null;
}

/**
 * Swap the current document out and the incoming one in, atomically.
 *
 * Returns the archive to store plus the incoming document's starting triple. A `null`
 * outgoing id is never archived (there is no document to archive it under), and a `null`
 * incoming id loads nothing. The current document is never present in its own archive,
 * so the restored entry is evicted on the way in — that single rule is what makes
 * "`byDocument` holds every *other* document" checkable rather than aspirational.
 */
export function swapDocument(
  current: CurrentDocument,
  byDocument: ReadonlyMap<string, DocumentTOCState>,
  documentId: string | null,
): { byDocument: Map<string, DocumentTOCState>; loaded: DocumentTOCState } {
  const next = new Map(byDocument);

  if (current.documentId !== null) {
    next.set(current.documentId, {
      headings: current.headings,
      collapsed: current.collapsed,
      active: current.active,
    });
  }

  if (documentId === null) {
    return { byDocument: next, loaded: emptyDocumentState() };
  }

  const loaded = next.get(documentId) ?? emptyDocumentState();
  next.delete(documentId);
  return { byDocument: next, loaded };
}
