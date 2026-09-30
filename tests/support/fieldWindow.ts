/**
 * @module tests/support/fieldWindow
 * Purpose: The D12 WI-6 `fieldWindow` flag (matrix "Shared test support"):
 * true only while a passthrough mock of `locateTableAtOffset`,
 * `cellAtOffset` or `cellAtResolvedLine` is executing, so windowed rope
 * counts attribute reads to the Source cursor field and not to lezer's
 * `DocInput.read`.
 *
 * Dependency-free on purpose: a `vi.mock` factory for `locate.ts` imports
 * it, and importing anything that imports `locate.ts` from inside that
 * factory would be circular. `tableSpanOracle.ts` re-exports it.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

/** Depth counter, so nested windowed calls keep the window open. */
export const fieldWindow = {
  depth: 0,
  get active(): boolean {
    return this.depth > 0;
  },
};

/** Wrap `fn` so the window is open for exactly the duration of each call. */
export function inFieldWindow<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  return (...args: A): R => {
    fieldWindow.depth += 1;
    try {
      return fn(...args);
    } finally {
      fieldWindow.depth -= 1;
    }
  };
}
