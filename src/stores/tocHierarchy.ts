/**
 * Purpose: `buildTOCHierarchy` — the pure, store-free transform from a flat list of
 * heading entries to a nested one, which used to sit at the bottom of `tocStore.ts`.
 *
 * Why this file exists: WI-3.5.5 added `resetCoordination` and its caller roster to
 * `tocStore.ts`, which pushed that file to 311 lines — past rule 50 §6's 300-line cap.
 * Rule 50 says extract rather than compress, and this was the honest thing to extract:
 * it touches neither Zustand, module-scope mutable state, nor the key sequence, so it
 * has no reason to live in a store. Nothing about its behaviour changed.
 *
 * It is re-exported from `tocStore.ts`, so `src/hooks/useTOC.ts` and existing tests keep
 * their import path. That is the same courtesy `DocumentTOCState` already gets from
 * `tocCoordination.ts`: the split is a file-size decision, not an API change.
 *
 * WI-3.5.5 also moved a second function here — a fourth anchor-slug generator with zero
 * callers that stripped CJK. **WI-3.5.8 deleted it** rather than leaving a wrong
 * implementation next to a correct one in the very layer whose job is to keep
 * coordination keys and anchor slugs apart. The three live slug faces are
 * `src/services/tocService.ts`, the `src/services/exportService.ts` fallback, and
 * `src-tauri/src/services/markdown.rs`; the normative allocator is
 * `src/utils/headingIdentity.ts`. `tests/dead-slug-removal.test.ts` fails if a fourth
 * one comes back.
 */
import type { TOCEntry } from "../types/toc";

/**
 * Build hierarchical TOC structure from flat entries
 */
export function buildTOCHierarchy(flatEntries: TOCEntry[]): TOCEntry[] {
  if (flatEntries.length === 0) return [];

  const result: TOCEntry[] = [];
  const stack: TOCEntry[] = [];

  for (const entry of flatEntries) {
    const newEntry: TOCEntry = { ...entry, children: [] };

    // Pop entries from stack that are at same or higher level
    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      // Top-level entry
      result.push(newEntry);
    } else {
      // Child of the last entry on stack
      stack[stack.length - 1].children.push(newEntry);
    }

    stack.push(newEntry);
  }

  return result;
}
