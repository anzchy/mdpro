/**
 * Purpose: decide what a finished save may write back to the store (D19). A save
 * awaits `get_preferences` and `save_file` / `save_file_dialog`; while it waits, the
 * user, the WYSIWYG edit-sync timer or an MCP write can change the document, or the
 * tab can be closed. This pure resolver compares the document as it is *after* the
 * await with the snapshot the save started from, and returns the only write that is
 * still true.
 *
 * Pipeline: save path → await IPC → re-read store document → `resolveSaveResult`
 *   → caller applies `next` (or nothing, for `closed`).
 *
 * Key decisions:
 * - Strict `===` on content, with no newline / CRLF / Unicode normalisation: any
 *   difference is an edit the disk does not hold.
 * - `next` is built from `current`, not the pre-await snapshot, so non-content
 *   fields changed during the await survive.
 * - Dirty is raised only when the store holds content this save did not write and
 *   nothing marked it dirty (D70: an older save landing after a newer one, or a
 *   document reopened clean under the same id with different content). Clean is
 *   kept only when the store holds exactly `writtenContent`.
 * - Store content equal to the formatted `writtenContent` but not the snapshot is
 *   treated as edited (conservatively dirty).
 * - Pure: no store, service, IPC or logging imports. The caller owns side effects.
 *
 * @coordinates-with src/services/saveService.ts — applies the resolution (D19-WI-3)
 * @coordinates-with src/hooks/useDocument.ts — the two save paths (D19-WI-4)
 * @module utils/saveResult
 */
import type { Document } from "../types/document";

/** Everything the resolver needs; `current` is read from the store after the await. */
export interface SaveResultInput {
  /** The store's document for the saved id after the await, or `undefined` if closed. */
  current: Document | undefined;
  /** The document content captured before the save's first await. */
  snapshotContent: string;
  /** The content actually written to disk (the snapshot, or its auto-reformat). */
  writtenContent: string;
  /** The path the file was written to (new for Save As). */
  path: string;
  /** The save timestamp returned by Rust (Unix epoch ms). */
  savedAt: number;
}

/** The outcome of a save, as a discriminated union on `kind`. */
export type SaveResolution =
  /** Nothing changed during the await: store takes the written content, clean. */
  | { kind: "applied"; next: Document }
  /** Content changed during the await: `path` / `lastSaved` are recorded, and dirty is
   * raised if the store content is not what was written (D70). */
  | { kind: "edited-during-save"; next: Document }
  /** The document was closed during the await: write nothing. */
  | { kind: "closed" };

/**
 * Resolve a completed save against the document as it is now.
 *
 * Invariant: a save never lowers the edit content and never leaves clean content it
 * did not write. Concretely:
 * - `current === undefined` ⇔ `{ kind: "closed" }` (no `next`);
 * - `current.content !== snapshotContent` ⇒ `next.content === current.content` and
 *   `next.isModified === (current.isModified || current.content !== writtenContent)`;
 * - a dirty → clean transition happens only in `applied`, with `next.content ===
 *   writtenContent`;
 * - `!next.isModified` ⇒ `next.content === writtenContent` (D70);
 * - fields other than `content`, `isModified`, `path` and `lastSaved` are carried
 *   over from `current` unchanged.
 *
 * Idempotent: resolving again with `current = next` yields a deep-equal `next`.
 * Pure: inputs are not mutated; `next` is always a fresh object.
 */
export function resolveSaveResult(input: SaveResultInput): SaveResolution {
  const { current, snapshotContent, writtenContent, path, savedAt } = input;

  if (current === undefined) {
    return { kind: "closed" };
  }

  if (current.content === snapshotContent) {
    return {
      kind: "applied",
      next: { ...current, content: writtenContent, isModified: false, path, lastSaved: savedAt },
    };
  }

  // D70: clean content the disk does not hold (an earlier save landing after a newer
  // one marked the buffer clean) is raised to dirty.
  const isModified = current.isModified || current.content !== writtenContent;
  return {
    kind: "edited-during-save",
    next: { ...current, isModified, path, lastSaved: savedAt },
  };
}
