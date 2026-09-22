/**
 * Purpose: the D7 `ui.toc.resolve.mismatch` warning — emitted when the outline's entries
 * and the WYSIWYG surface's heading elements disagree in count — extracted from
 * `useWysiwygScrollSpy` so the hook stays a lifecycle file.
 *
 * Key decisions:
 * - One warning per *changed* `(entryCount, domCount)` signature, per hook instance (the
 *   caller owns the ref). Unconditional emission would fire once per 300 ms debounce tick
 *   for as long as the document holds a heading our parser cannot see.
 * - Context is counts and the document id only — never heading text or content.
 *
 * `@module src/utils/tocResolveMismatch`
 * `@coordinates-with` `src/hooks/useWysiwygScrollSpy.ts` (the only caller),
 * `src/utils/tocElementResolution.ts` (`HeadingResolution.mismatch`).
 */
import { loggingService } from "../services/loggingService";
import type { resolveHeadingElements } from "./tocElementResolution";

/** Warn once per changed signature; always record the signature seen. */
export function reportResolveMismatch(
  resolution: ReturnType<typeof resolveHeadingElements>,
  entryCount: number,
  documentId: string | null,
  signatureRef: { current: string | null },
): void {
  const domCount = resolution.mismatch?.domCount ?? entryCount;
  const signature = `${entryCount}:${domCount}`;
  if (resolution.mismatch && signature !== signatureRef.current) {
    loggingService.logEventSync({
      level: "warn",
      event: "ui.toc.resolve.mismatch",
      status: "fail",
      actionId: loggingService.generateActionId(),
      context: {
        documentId,
        entryCount,
        domCount,
        resolvedCount: resolution.byKey.size,
      },
    });
  }
  signatureRef.current = signature;
}
