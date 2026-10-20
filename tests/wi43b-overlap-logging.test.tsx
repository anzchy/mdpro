/**
 * WI-4.3b round 2 (PR #508, F508-1): Advanced's two logging writes in flight.
 *
 * The switch and Log Level used to read each other's value from the store,
 * which only moves after a write lands, so a second write sent while the first
 * was pending carried the stale value. Now they are queued, and each is built
 * from the confirmed value when it is sent.
 *
 * Mock boundary: `@tauri-apps/api/core#invoke` only; `loggingService`, the
 * stores and the component are real, so each rejection raises the service's
 * own toast.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock({ isTauri: true }),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { AdvancedSettings } from "../src/components/common/settings/AdvancedSettings";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";

interface Settings {
  enabled: boolean;
  level: string;
}

let sent: Partial<Settings>[] = [];
let held: { resolve: () => void; reject: () => void }[] = [];
let persisted: Settings;
let toasts: string[] = [];
let stopToasts: () => void = () => {};

beforeEach(() => {
  sent = [];
  held = [];
  persisted = { enabled: false, level: "info" };
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string, args?: { group: string; patch: Partial<Settings> }) => {
    if (command !== "patch_settings_group" || !args) return Promise.resolve(undefined);
    expect(args.group).toBe("logging");
    sent.push(args.patch);
    return new Promise((resolve, reject) => {
      held.push({
        resolve: () => { persisted = { ...persisted, ...args.patch }; resolve({ ...persisted }); },
        reject: () => reject(new Error("write failed")),
      });
    });
  });
  useLoggingStore.setState({ enabled: false, level: "info" });
  useToastStore.setState({ message: null });
  toasts = [];
  stopToasts = useToastStore.subscribe((s) => {
    if (s.message !== null) toasts.push(s.message);
  });
});

afterEach(() => {
  stopToasts();
  cleanup();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

async function toggleThenLevel() {
  const user = userEvent.setup();
  render(<AdvancedSettings />);
  const sw = screen.getByRole("switch", { name: "Enable Logging" });
  const select = screen.getByRole("combobox", { name: "Log Level" });
  await user.click(sw);
  await user.selectOptions(select, "error");
  await settle();
  return { sw, select };
}

describe("F508-1: Advanced's overlapping logging writes", () => {
  it("the second write carries the first one's confirmed value, and the UI ends at the backend's", async () => {
    const { sw, select } = await toggleThenLevel();
    expect(sent).toEqual([{ enabled: true }]);

    held[0].resolve();
    await settle();
    expect(sent[1]).toEqual({ level: "error" });
    held[1].resolve();
    await settle();

    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(select).toHaveValue("error");
    expect(useLoggingStore.getState()).toMatchObject({ enabled: true, level: "error" });
    expect(toasts).toEqual([]);
  });

  it("first rejected, second saved: the second is built from the saved values", async () => {
    const { sw, select } = await toggleThenLevel();
    held[0].reject();
    await settle();
    expect(sent[1]).toEqual({ level: "error" });
    held[1].resolve();
    await settle();

    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(select).toHaveValue("error");
    expect(useLoggingStore.getState()).toMatchObject({ enabled: false, level: "error" });
    expect(toasts).toEqual(["Failed to save preferences"]);
  });

  it("two rejected writes leave the saved values, with one toast per rejection and no inline error", async () => {
    const { sw, select } = await toggleThenLevel();
    held[0].reject();
    await settle();
    held[1].reject();
    await settle();

    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(select).toHaveValue("info");
    expect(useLoggingStore.getState()).toMatchObject({ enabled: false, level: "info" });
    expect(toasts).toEqual(["Failed to save preferences", "Failed to save preferences"]);
    expect(document.querySelector(".settings-error")).toBeNull();
  });
});
