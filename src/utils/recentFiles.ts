/**
 * Purpose: the pure list operations behind the Recent Files list — push one path
 * to the front, and merge updates buffered before preference hydration into the
 * stored list (ADR-0031 step 5a, WI-5, finding F1).
 *
 * Pipeline: `useRecentFiles` → `pushRecent` (each update after hydration) /
 *   `mergePending` (once, at hydration) → `preferencesService.setPreferences`.
 *
 * Key decisions:
 * - `pushRecent` is the updater App.tsx used before the extraction, moved
 *   verbatim: an empty path is a no-op, an existing path moves to the front,
 *   and the result is capped at `MAX_RECENT_FILES`. Duplicates already in the
 *   stored list are conserved, not deduped.
 * - `mergePending` is defined as replaying the buffer oldest-first through
 *   `pushRecent`, so buffering then hydrating is indistinguishable from
 *   applying the same updates after hydration.
 *
 * @coordinates-with src/hooks/useRecentFiles.ts
 */

/** How many paths the Recent Files list keeps. */
export const MAX_RECENT_FILES = 10;

/** Move `path` to the front of `list`, capped at `MAX_RECENT_FILES`. An empty path is a no-op. */
export function pushRecent(list: readonly string[], path: string): string[] {
  if (!path) return [...list];
  return [path, ...list.filter((item) => item !== path)].slice(0, MAX_RECENT_FILES);
}

/**
 * Merge updates buffered before hydration into the stored list.
 *
 * @param stored the list read from preferences
 * @param pendingNewestFirst buffered paths, most recent first
 */
export function mergePending(
  stored: readonly string[],
  pendingNewestFirst: readonly string[],
): string[] {
  return pendingNewestFirst.reduceRight<string[]>(
    (list, path) => pushRecent(list, path),
    [...stored],
  );
}
