/**
 * WI-4.3b round 4 (PR #508, N1 class): one settings writer per group, above the
 * dialog.
 *
 * Closing Settings unmounts every page, and reopening mounts new ones, but a
 * group's writes, its shown value and its confirmed value live in a module
 * registry that outlives both:
 * - nothing queued is dropped: every write is sent, in order, built when sent
 *   from the confirmed value;
 * - a page reopened while its group is writing shows the live value, and its
 *   load is ignored until the group is idle;
 * - a write that never settles counts as failed after
 *   SETTINGS_WRITE_TIMEOUT_MS (toast and rollback), and the queue moves on;
 * - typing not yet saved is discarded on close, as before;
 * - a write from a closed instance is refused.
 *
 * Mock boundary: a controlled `save` for the hook cases; spies on
 * `preferencesService` and `loggingService.setLoggingSettings` for the pages.
 */
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { AdvancedSettings } from "../src/components/common/settings/AdvancedSettings";
import {
  resetSettingsWriterRegistry,
  SETTINGS_WRITE_TIMEOUT_MS,
} from "../src/components/common/settings/settingsWriterRegistry";
import { useSettingsWriter } from "../src/components/common/settings/useSettingsWriter";
import { loggingService } from "../src/services/loggingService";
import { preferencesService } from "../src/services/preferencesService";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";
import { installBoundary } from "./support/settingsRowSites";
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
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

interface Slice {
  a: number;
  b: number;
}

interface Held<T> {
  value: T;
  resolve: () => void;
  reject: () => void;
}

function controlled<T>() {
  const sent: Held<T>[] = [];
  const save = vi.fn(
    (value: T) =>
      new Promise<void>((resolve, reject) => {
        sent.push({ value, resolve: () => resolve(), reject: () => reject(new Error("write failed")) });
      }),
  );
  return { save, sent };
}

function mountWriter(group: string, save: (next: Slice) => Promise<unknown>, loaded: Slice = { a: 0, b: 0 }) {
  const apply = vi.fn();
  const onConfirm = vi.fn();
  const hook = renderHook(() => useSettingsWriter<Slice>({ group, save, apply, onConfirm }));
  act(() => hook.result.current.load(loaded));
  return { ...hook, apply, onConfirm };
}

describe("the group writer across close and reopen", () => {
  it("sends every queued write after the page closed, in order, and confirms each", async () => {
    const { save, sent } = controlled<Slice>();
    const first = mountWriter("r1", save);
    act(() => void first.result.current.write({ a: 1 }));
    act(() => void first.result.current.write({ b: 2 }));
    await settle();
    first.unmount();
    sent[0].resolve();
    await settle();
    expect(sent).toHaveLength(2);
    sent[1].resolve();
    await settle();
    expect(sent.map((s) => s.value)).toEqual([
      { a: 1, b: 0 },
      { a: 1, b: 2 },
    ]);
    expect(first.onConfirm).toHaveBeenLastCalledWith({ a: 1, b: 2 });
  });

  it("a page reopened mid-write shows the live value and ignores its own load until the group is idle", async () => {
    const { save, sent } = controlled<Slice>();
    const first = mountWriter("r2", save);
    act(() => void first.result.current.write({ a: 1 }));
    await settle();
    first.unmount();

    const second = renderHook(() => useSettingsWriter<Slice>({ group: "r2", save }));
    expect(second.result.current.value).toEqual({ a: 1, b: 0 });
    // The read the reopened page issued predates the write.
    act(() => second.result.current.load({ a: 0, b: 0 }));
    expect(second.result.current.value).toEqual({ a: 1, b: 0 });
    sent[0].resolve();
    await settle();
    expect(second.result.current.value).toEqual({ a: 1, b: 0 });
    act(() => void second.result.current.write({ b: 3 }));
    await settle();
    expect(sent[1].value).toEqual({ a: 1, b: 3 });
  });

  it("a write that failed after the page closed returns the live app to the confirmed value", async () => {
    const { save, sent } = controlled<Slice>();
    const first = mountWriter("r3", save);
    act(() => void first.result.current.write({ a: 1 }));
    await settle();
    first.unmount();
    sent[0].reject();
    await settle();
    expect(first.apply).toHaveBeenLastCalledWith("a", 0);
    expect(first.onConfirm).not.toHaveBeenCalled();
  });

  it("closing discards typing not yet saved: never sent, and shown back at the confirmed value", async () => {
    const { save, sent } = controlled<Slice>();
    const first = mountWriter("r4", save);
    act(() => first.result.current.edit({ a: 9 }));
    act(() => void first.result.current.write({ b: 1 }));
    await settle();
    act(() => first.result.current.edit({ a: 7 }));
    first.unmount();
    await settle();
    sent[0].resolve();
    await settle();
    expect(first.apply).toHaveBeenLastCalledWith("a", 9);
    expect(sent.map((s) => s.value)).toEqual([{ a: 9, b: 1 }]);
  });

  it("refuses a write from an instance that has closed", async () => {
    const { save } = controlled<Slice>();
    const first = mountWriter("r5", save);
    const { write } = first.result.current;
    first.unmount();
    let saved: Promise<boolean> = Promise.resolve(true);
    act(() => {
      saved = write({ a: 1 });
    });
    await expect(saved).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("a write that never settles counts as failed after the timeout: toast, rollback, and the queue moves on", async () => {
    vi.useFakeTimers();
    const sent: Slice[] = [];
    const save = vi.fn((next: Slice) => {
      sent.push(next);
      return sent.length === 1 ? new Promise<void>(() => {}) : Promise.resolve();
    });
    const { result, apply } = mountWriter("r6", save);
    act(() => void result.current.write({ a: 1 }));
    act(() => void result.current.write({ b: 2 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTINGS_WRITE_TIMEOUT_MS - 1);
    });
    expect(sent).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(useToastStore.getState().message).toBe("Failed to save preferences");
    expect(apply).toHaveBeenCalledWith("a", 0);
    expect(sent).toEqual([
      { a: 1, b: 0 },
      { a: 0, b: 2 },
    ]);
    expect(result.current.value).toEqual({ a: 0, b: 2 });
  });
});

function holdPreferences(): Held<number | undefined>[] {
  const held: Held<number | undefined>[] = [];
  vi.mocked(preferencesService.setPreferences).mockImplementation(
    (p) =>
      new Promise((resolve, reject) => {
        held.push({
          value: p.autoSaveInterval,
          resolve: () => resolve(p as never),
          reject: () => reject(new Error("write failed")),
        });
      }),
  );
  return held;
}

describe("General: two interval writes pending when Settings closes, then reopened", () => {
  async function scenario(firstOutcome: "resolve" | "reject") {
    const user = userEvent.setup();
    installBoundary();
    const held = holdPreferences();
    useEditorStore.setState({ autoSaveInterval: 30 });

    const first = renderStatePage("general");
    const interval = await screen.findByRole("combobox", { name: "Auto-save Interval" });
    await user.selectOptions(interval, "60");
    await user.selectOptions(interval, "120");
    await settle();
    first.unmount();

    renderStatePage("general");
    const reopened = await screen.findByRole("combobox", { name: "Auto-save Interval" });
    await settle();
    expect(reopened).toHaveValue("120");
    await user.selectOptions(reopened, "300");
    await settle();

    held[0][firstOutcome]();
    await settle();
    held[1]?.resolve();
    await settle();
    held[2]?.resolve();
    await settle();
    return { held, reopened };
  }

  it("sends 60, 120 and 300 in turn, and the page and the store end at 300", async () => {
    const { held, reopened } = await scenario("resolve");
    expect(held.map((h) => h.value)).toEqual([60, 120, 300]);
    expect(reopened).toHaveValue("300");
    expect(useEditorStore.getState().autoSaveInterval).toBe(300);
  });

  it("with 60 rejected, 120 and 300 are still sent, and the page and the store end at 300", async () => {
    const { held, reopened } = await scenario("reject");
    expect(held.map((h) => h.value)).toEqual([60, 120, 300]);
    expect(reopened).toHaveValue("300");
    expect(useEditorStore.getState().autoSaveInterval).toBe(300);
  });

  it("a page reopened mid-write shows the live value, not the older value its read returns", async () => {
    const user = userEvent.setup();
    installBoundary();
    const held = holdPreferences();
    useEditorStore.setState({ autoSaveInterval: 30 });

    const first = renderStatePage("general");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Auto-save Interval" }), "120");
    await settle();
    first.unmount();

    renderStatePage("general");
    const reopened = await screen.findByRole("combobox", { name: "Auto-save Interval" });
    await settle();
    expect(reopened).toHaveValue("120");
    expect(useEditorStore.getState().autoSaveInterval).toBe(120);
    held[0].resolve();
    await settle();
    expect(reopened).toHaveValue("120");
    expect(useEditorStore.getState().autoSaveInterval).toBe(120);
  });
});

describe("Advanced: logging switched off, then a tab switch before the write settles", () => {
  function holdLogging() {
    const held: Held<{ enabled: boolean; level: string }>[] = [];
    vi.mocked(loggingService.setLoggingSettings).mockImplementation(
      (s) =>
        new Promise((resolve, reject) => {
          held.push({ value: s, resolve: () => resolve(s), reject: () => reject(new Error("write failed")) });
        }),
    );
    return held;
  }

  it("coming back shows the switch off, and the store ends off when the write lands", async () => {
    const user = userEvent.setup();
    installBoundary();
    const held = holdLogging();
    useLoggingStore.setState({ enabled: true, level: "info" });

    const first = render(<AdvancedSettings />);
    await user.click(screen.getByRole("switch", { name: "Enable Logging" }));
    await settle();
    first.unmount();

    render(<AdvancedSettings />);
    const sw = screen.getByRole("switch", { name: "Enable Logging" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    held[0].resolve();
    await settle();
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(useLoggingStore.getState().enabled).toBe(false);
    expect(held.map((h) => h.value)).toEqual([{ enabled: false, level: "info" }]);
  });

  it("staying on another tab, the store still ends off when the write lands", async () => {
    const user = userEvent.setup();
    installBoundary();
    const held = holdLogging();
    useLoggingStore.setState({ enabled: true, level: "info" });

    const first = render(<AdvancedSettings />);
    await user.click(screen.getByRole("switch", { name: "Enable Logging" }));
    await settle();
    first.unmount();
    renderStatePage("general");
    held[0].resolve();
    await settle();
    expect(useLoggingStore.getState().enabled).toBe(false);
  });
});
