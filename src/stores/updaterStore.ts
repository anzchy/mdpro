import { create } from "zustand";

/**
 * Purpose: Persist updater state across Settings dialog open/close cycles.
 * Only 'up-to-date' and 'error' are safe to cache — 'available' holds
 * an opaque Update handle that may become stale on remount.
 *
 * Key decisions:
 * - The cache is owned by the most recently started check (D110). A check
 *   takes an id from `beginRequest()` and passes it to every write; a write
 *   whose id has been superseded is dropped, so a late answer from an older
 *   check (e.g. one started before the About panel remounted) can neither
 *   overwrite nor clear a newer check's result.
 * - A write without an id is unconditional (tests, and any owner-less reset).
 */

export type CacheSafeState =
  | { phase: "up-to-date" }
  | { phase: "error"; message: string }
  | { phase: "updates-disabled" };

interface UpdaterStore {
  cachedResult: CacheSafeState | null;
  /** Id of the most recently started check; 0 before the first one. */
  activeRequestId: number;
  /** Start a check: returns its id, superseding every earlier one. */
  beginRequest: () => number;
  /** Cache `result`; with `requestId`, only if that check is still current. Returns whether it applied. */
  setCachedResult: (result: CacheSafeState, requestId?: number) => boolean;
  /** Clear the cache; with `requestId`, only if that check is still current. Returns whether it applied. */
  clearCache: (requestId?: number) => boolean;
}

export const useUpdaterStore = create<UpdaterStore>((set, get) => {
  const owns = (requestId?: number) =>
    requestId === undefined || requestId === get().activeRequestId;
  return {
    cachedResult: null,
    activeRequestId: 0,
    beginRequest: () => {
      const id = get().activeRequestId + 1;
      set({ activeRequestId: id });
      return id;
    },
    setCachedResult: (result, requestId) => {
      if (!owns(requestId)) return false;
      set({ cachedResult: result });
      return true;
    },
    clearCache: (requestId) => {
      if (!owns(requestId)) return false;
      set({ cachedResult: null });
      return true;
    },
  };
});
