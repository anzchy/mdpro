import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn(async (cmd: string) => {
  if (cmd === "get_applied_shortcuts") throw new Error("IPC unavailable");
  return null;
}));
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ isTauri: true, invoke }),
);

import { useAppliedShortcuts } from "../src/hooks/useAppliedShortcuts";
import { currentAppliedShortcuts } from "../src/commands/appliedKeymap";

afterEach(() => invoke.mockClear());

it("keeps shortcut consumers inert and exposes an error when applied IPC rejects", async () => {
  const hook = renderHook(() => useAppliedShortcuts());
  await waitFor(() => expect(hook.result.current.error).toBe(true));
  expect(hook.result.current.snapshot).toBeNull();
  expect(currentAppliedShortcuts()).toBeNull();
  expect(invoke.mock.calls.some(([command]) => command === "get_applied_shortcuts")).toBe(true);
  hook.unmount();
});
