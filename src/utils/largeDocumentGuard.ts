/**
 * Purpose: the pure decision function behind the WYSIWYG large-document
 * guardrail — "is this document too big to open in the WYSIWYG surface, and if
 * so what do we tell the user?". Extracted verbatim from the `useEffect` at
 * `src/App.tsx:510-519` so the arithmetic can be unit tested for behaviour
 * instead of existing only as six untested lines inside a 1200-line component.
 * Precedent for the shape: `src/utils/dataLossGuards.ts` — a pure `decideX(...)`
 * returning a discriminated union that App.tsx consumes with an exhaustive
 * `switch`.
 *
 * SCOPE — read before touching the number below.
 *
 * ADR-0006 (`:107-113`, `:201-203`) draws a line this module must not cross:
 * the guard's *mechanism* is retained, its *predicate* is deferred. The ADR
 * records that the mechanism is verified effective in the field, and that what
 * is actually wrong is (a) the threshold — 471,880 bytes is admitted today —
 * and (b) the judgement variable, because the real cost tracks cells in the
 * largest single table rather than document bytes. It then states plainly that
 * re-choosing the predicate waits on a sweep on the real WKWebView, because the
 * measurements taken so far were in V8/jsdom with no layout engine and do not
 * transfer.
 *
 * Therefore:
 * - **D6.1** owns the threshold value. It is frozen at `500 * 1024` until D6.1's
 *   real-device sweep has run. That sweep has not run.
 * - **D6.2** owns the judgement variable — bytes vs. table cells, and the
 *   related question of whether a stale on-disk `fileSize` should beat live
 *   in-memory content (it does today; see the characterization tests).
 *
 * Editing the threshold, the `<=` direction, or the `fileSize ?? measure(content)`
 * precedence *here*, without D6.1's sweep, contradicts an Accepted ADR. This
 * module is a behaviour-preserving extraction plus a characterization net; it is
 * not a threshold change and must not become one by accident.
 *
 * @module src/utils/largeDocumentGuard
 * @coordinates-with src/App.tsx (the WYSIWYG large-document guardrail effect)
 */

import type { ViewMode } from "../types/editor";

/**
 * The byte count at or below which a document is allowed to stay in WYSIWYG.
 *
 * FROZEN under ADR-0006 pending D6.1's WKWebView sweep. See the module header.
 */
export const LARGE_DOCUMENT_THRESHOLD_BYTES = 500 * 1024;

/** The toast copy shown when the guardrail forces a document into Source mode. */
export const LARGE_DOCUMENT_DOWNGRADE_MESSAGE =
  "Document exceeds 500KB. Switched to Source mode for performance.";

/**
 * Everything the guardrail needs to decide.
 *
 * Deliberately NOT nullable: the `!activeDocument` early return stays in the
 * caller, exactly as it does for the `decideFileChange` effect above it.
 */
export interface LargeDocumentGuardInput {
  viewMode: ViewMode;
  /** On-disk size in bytes as of when the document was opened, or `null`. */
  fileSize: number | null;
  content: string;
}

/**
 * - `allow`: leave the view mode alone, say nothing.
 * - `degrade-to-source`: show `message`, then switch to Source mode. `bytes` is
 *   the effective byte count the predicate actually judged, carried so callers
 *   and tests can see *which* number produced the decision.
 */
export type LargeDocumentGuardDecision =
  | { action: "allow" }
  | { action: "degrade-to-source"; message: string; bytes: number };

/**
 * Decide whether a document may stay in WYSIWYG mode.
 *
 * Order is load-bearing: the view-mode gate runs before any byte computation,
 * and the on-disk `fileSize` short-circuits measuring `content`. Both exist so
 * a multi-megabyte string is never encoded when the answer is already known.
 */
export function decideLargeDocumentGuard(
  input: LargeDocumentGuardInput,
): LargeDocumentGuardDecision {
  if (input.viewMode !== "wysiwyg") return { action: "allow" };

  // `??`, not `||`: a zero-byte file has a known size of 0 and must not fall
  // through to measuring the in-memory content.
  const bytes = input.fileSize ?? new TextEncoder().encode(input.content).length;

  if (bytes <= LARGE_DOCUMENT_THRESHOLD_BYTES) return { action: "allow" };

  return {
    action: "degrade-to-source",
    message: LARGE_DOCUMENT_DOWNGRADE_MESSAGE,
    bytes,
  };
}
