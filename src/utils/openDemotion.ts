/**
 * Purpose: decide whether an open's decoded document may become a clean point
 * (D214-WI-6/7). The open guard (`openWriteGuard.commitOpenedDocument`) asks this after
 * the read's await, with the baseline generation the open captured before its IPC.
 *
 * Pipeline: `useDocument` open route captures `baselineGeneration` → IPC → guard →
 *   `movedDuringOpen(opened, replaced, start)` → demoted: written dirty with no
 *   baseline, `file.open.reload_clean` carries `demotion(true)`.
 *
 * Key decisions:
 * - Demote when ANY of these was stamped after `start`: the tab being replaced (id or
 *   D145 path match, WI-6), the opened document's id, or its path (WI-7). The last two
 *   cover a reply whose tab was dropped and then closed during the read (a close
 *   stamps), including a UUID tab matched only by path.
 * - Accepted cost: closing the tab while an open of the same file is in flight demotes
 *   that open too. That is a false dirty, never a lost edit.
 * - Logs carry the enum reason only (rule 20), never content or a path.
 *
 * @coordinates-with src/utils/openWriteGuard.ts — the only caller
 * @coordinates-with src/stores/documentStore.ts — `baselineMovedSince`, `baselinePathMovedSince`
 * @module utils/openDemotion
 */
import { baselineMovedSince, baselinePathMovedSince } from "../stores/documentStore";
import type { Document } from "../types/document";

/** Did the baseline of the replaced tab, the opened id or the opened path move since `start`? */
export function movedDuringOpen(opened: Document, replaced: Document | undefined, start: number | undefined): boolean {
  return (
    (replaced !== undefined && baselineMovedSince(replaced.id, start)) ||
    baselineMovedSince(opened.id, start) ||
    baselinePathMovedSince(opened.path, start)
  );
}

/** The log fields of a demoted open (enum only); nothing for a clean one. */
export const demotion = (demoted: boolean) =>
  demoted ? { demoted, reason: "external_change_during_open" as const } : {};
