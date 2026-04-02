import { create } from "zustand";

/**
 * Purpose: Persist updater state across Settings dialog open/close cycles.
 * Only 'up-to-date' and 'error' are safe to cache — 'available' holds
 * an opaque Update handle that may become stale on remount.
 */

export type CacheSafeState =
  | { phase: "up-to-date" }
  | { phase: "error"; message: string }
  | { phase: "updates-disabled" };

interface UpdaterStore {
  cachedResult: CacheSafeState | null;
  setCachedResult: (result: CacheSafeState) => void;
  clearCache: () => void;
}

export const useUpdaterStore = create<UpdaterStore>((set) => ({
  cachedResult: null,
  setCachedResult: (result) => set({ cachedResult: result }),
  clearCache: () => set({ cachedResult: null }),
}));
