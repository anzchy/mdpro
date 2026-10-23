import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { useShortcutConflictNotice } from "../src/hooks/useShortcutConflictNotice";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";

it("names a newly displaced default once, then stays quiet after restart", () => {
  const upgraded = defaultAppliedShortcuts("macos");
  upgraded.bindings.paragraphTable = { state: "suppressed", reason: "yieldedToCustom" };
  const saved = { ...DEFAULT_KEYBOARD_SHORTCUTS, fileSave: "Cmd+Shift+T", paragraphTable: "<unassigned>" };
  const first = renderHook(() => useShortcutConflictNotice(upgraded, saved));
  expect(first.result.current.message).toContain("Table (Cmd+Shift+T)");
  act(() => first.result.current.dismiss());
  expect(first.result.current.message).toBeNull();
  first.unmount();
  const restarted = defaultAppliedShortcuts("macos");
  restarted.bindings.paragraphTable = { state: "unassigned" };
  const next = renderHook(() => useShortcutConflictNotice(restarted, saved));
  expect(next.result.current.message).toBeNull();
  next.unmount();
});
