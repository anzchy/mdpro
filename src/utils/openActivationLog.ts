/**
 * Purpose: the shared activation fields an open-by-path outcome log carries
 * (`file.open.drop`, `file.open.route`, `file.open.url_param`), so every path that
 * reports activation uses the same names (D125, ADR-0071 decision 3).
 *
 * Key decisions:
 * - The log's `status` stays the open's own answer (`success` when a document came
 *   back); a D92-refused activation is not a failure of the open, so it is a
 *   `success` with `activated: false` and `reason: "flush-failed"`, never `fail`.
 * - `reason` appears only on a refusal. A failed open (no document) carries
 *   `activated: false` with no reason; its `fail` status and error say why.
 *
 * @coordinates-with src/hooks/useOpenPaths.ts — the drop's outcome log
 * @coordinates-with src/hooks/useOpenInWindow.ts — the route's outcome log
 * @coordinates-with src/hooks/useOpenUrlParam.ts — the `?open=` outcome log
 */

/** The reason a refused activation logs: the WYSIWYG flush of the current tab failed. */
export const ACTIVATION_REFUSED_REASON = "flush-failed";

export type OpenActivationContext =
  | { activated: true }
  | { activated: false; reason?: typeof ACTIVATION_REFUSED_REASON };

/**
 * The activation fields for an open's outcome: `{ activated: true }` when the opened
 * document became active, `{ activated: false, reason: "flush-failed" }` when the
 * D92 guard refused the switch, and `{ activated: false }` when nothing opened.
 */
export function openActivationContext(opened: { activated: boolean } | null | undefined): OpenActivationContext {
  if (!opened) return { activated: false };
  if (opened.activated) return { activated: true };
  return { activated: false, reason: ACTIVATION_REFUSED_REASON };
}
