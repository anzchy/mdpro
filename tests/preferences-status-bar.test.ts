import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { preferencesService } from "../src/services/preferencesService";

describe("preferencesService persists showStatusBar", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // Force Tauri-env path so setPreferences hits invoke (the boundary).
    (globalThis as Record<string, unknown>).__TAURI__ = {};
  });

  // B4: the showStatusBar value reaches the IPC boundary AND the resolved
  // preferences echo it back (mock invoke to merge into returned prefs).
  it("sends showStatusBar:true to invoke and returns it merged", async () => {
    invokeMock.mockImplementation(
      async (_cmd: string, payload: { preferences: Record<string, unknown> }) => ({
        showStatusBar: payload.preferences.showStatusBar,
      }),
    );

    const result = await preferencesService.setPreferences({ showStatusBar: true });

    // Value reached the boundary
    expect(invokeMock).toHaveBeenCalledWith("set_preferences", {
      preferences: { showStatusBar: true },
    });
    // Resolved object reflects it
    expect(result.showStatusBar).toBe(true);
  });
});
