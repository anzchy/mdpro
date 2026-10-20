import { act, cleanup, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { resetSettingsWriterRegistry } from "../src/components/common/settings/settingsWriterRegistry";
import { shownValue } from "../src/components/common/settings/settingsWriterRegistry";
import { useSettingsWriter } from "../src/components/common/settings/useSettingsWriter";
import { preferencesService } from "../src/services/preferencesService";
import { useEditorStore } from "../src/stores/editorStore";
import { useToastStore } from "../src/stores/toastStore";
import type { EditorConfig, UserPreferences } from "../src/types/preferences";
import { installBoundary, LOADED } from "./support/settingsRowSites";
import { renderStatePage } from "./support/settingsStatePages";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetSettingsWriterRegistry();
  useToastStore.setState({ message: null });
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("a save that succeeds after 10 seconds confirms the late value without a false failure toast", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const apply = vi.fn();
  const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const hook = renderHook(() => useSettingsWriter({ group: "late", save, apply }));
  act(() => hook.result.current.load({ a: 0, b: 0 }));
  let write!: Promise<boolean>;
  act(() => { write = hook.result.current.write({ a: 1 }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(hook.result.current.value).toEqual({ a: 1, b: 0 });
  expect(apply).not.toHaveBeenCalledWith("a", 0);
  expect(useToastStore.getState().message).toBeNull();
  finish();
  await act(async () => { await expect(write).resolves.toBe(true); });
  expect(hook.result.current.value).toEqual({ a: 1, b: 0 });
});

it("a reopened page rejects a read begun during a queued write even when the read returns after drain", async () => {
  const user = userEvent.setup();
  installBoundary();
  useEditorStore.setState({ autoSaveInterval: 30 });
  let deliverRead!: (value: UserPreferences) => void;
  let reads = 0;
  vi.mocked(preferencesService.getPreferences).mockImplementation(() => {
    reads += 1;
    return reads === 1
      ? Promise.resolve({ ...LOADED, autoSaveInterval: 30 })
      : new Promise((resolve) => { deliverRead = resolve; });
  });
  const writes: Array<() => void> = [];
  vi.mocked(preferencesService.setPreferences).mockImplementation(
    (patch) => new Promise((resolve) => { writes.push(() => resolve({ ...LOADED, ...patch })); }),
  );
  const first = renderStatePage("general");
  await user.selectOptions(await screen.findByRole("combobox", { name: "Auto-save Interval" }), "60");
  await user.selectOptions(screen.getByRole("combobox", { name: "Auto-save Interval" }), "120");
  await settle();
  first.unmount();
  renderStatePage("general");
  const reopened = screen.getByRole("combobox", { name: "Auto-save Interval" });
  writes[0]();
  await settle();
  writes[1]();
  await settle();
  deliverRead({ ...LOADED, autoSaveInterval: 30 });
  await settle();
  expect(reopened).toHaveValue("120");
  expect(shownValue<{ autoSaveInterval: number }>("general")?.autoSaveInterval).toBe(120);
  expect(useEditorStore.getState().autoSaveInterval).toBe(120);
});

it("an Editor late read cannot erase confirmed line height before a sibling save", async () => {
  const user = userEvent.setup();
  installBoundary();
  let deliverRead!: (value: UserPreferences) => void;
  let reads = 0;
  vi.mocked(preferencesService.getPreferences).mockImplementation(() => {
    reads += 1;
    return reads === 1 ? Promise.resolve(LOADED) : new Promise((resolve) => { deliverRead = resolve; });
  });
  let finish!: (value: EditorConfig) => void;
  const saved = vi.spyOn(preferencesService, "patchPreferences").mockImplementation(
    (_group, patch, snapshot) => {
      if ("lineHeightX10" in patch) return new Promise((resolve) => { finish = resolve as typeof finish; });
      return Promise.resolve(snapshot as EditorConfig);
    },
  );
  const first = renderStatePage("editor");
  await user.selectOptions(await screen.findByRole("combobox", { name: "Line Height" }), "18");
  await settle();
  first.unmount();
  renderStatePage("editor");
  finish({ ...LOADED.editor, lineHeightX10: 18 });
  await settle();
  deliverRead(LOADED);
  await settle();
  await user.selectOptions(screen.getByRole("combobox", { name: "Font Family" }), "serif");
  await settle();
  expect(saved.mock.calls.at(-1)?.[1]).toEqual({ fontFamily: "serif" });
  expect(saved.mock.calls.at(-1)?.[2]).toEqual(expect.objectContaining({ lineHeightX10: 18 }));
});

it("a fresh mount after the last writer drains can load a new disk value", async () => {
  let finish!: () => void;
  const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const first = renderHook(() => useSettingsWriter({ group: "forget", save }));
  act(() => first.result.current.load({ a: 30 }));
  act(() => void first.result.current.write({ a: 60 }));
  await settle();
  first.unmount();
  finish();
  await settle();
  const reopened = renderHook(() => useSettingsWriter({ group: "forget", save }));
  act(() => reopened.result.current.load({ a: 90 }, reopened.result.current.readTicket()));
  expect(reopened.result.current.value).toEqual({ a: 90 });
});
