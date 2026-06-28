/**
 * WI-0.5 — write-through save-failure UX.
 *
 * The preferences write-through model previously failed silently on a disk
 * error: many call sites do `void preferencesService.setPreferences(...)`, so a
 * rejected invoke vanished with no user signal. setPreferences must now surface
 * a "Failed to save preferences" toast on failure (and still reject so callers
 * that await can react).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { preferencesService } from "../src/services/preferencesService";
import { useToastStore } from "../src/stores/toastStore";

describe("preferencesService.setPreferences — write-through failure UX", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useToastStore.setState({ message: null });
    // Force the Tauri code path (isTauri is evaluated at module load; stub the
    // global so the service issues a real invoke).
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
  });

  afterEach(() => {
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  });

  it("shows a 'Failed to save preferences' toast when the backend rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      preferencesService.setPreferences({ showSidebar: false }),
    ).rejects.toThrow();
    expect(useToastStore.getState().message).toMatch(/failed to save preferences/i);
  });

  it("does not toast on a successful save", async () => {
    invokeMock.mockResolvedValueOnce({ showSidebar: false });
    await preferencesService.setPreferences({ showSidebar: false });
    expect(useToastStore.getState().message).toBeNull();
  });

  it("re-rejects so awaiting callers can still handle the error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("EACCES"));
    await expect(
      preferencesService.setPreferences({ showSidebar: true }),
    ).rejects.toThrow(/EACCES/);
  });
});
